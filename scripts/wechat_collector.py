"""Local, read-only wxauto4 bridge. Never sends messages or reads private chats.

Live UI access is gated by a successful read-only compatibility probe.
Discovery only accepts explicitly identified group metadata. Missing capabilities
are reported rather than guessed. The server also enforces the group whitelist.
"""
import argparse
import hashlib
import json
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
CN = timezone(timedelta(hours=8))


class Bridge:
    def __init__(self, root=ROOT, port=4317):
        self.base = f"http://127.0.0.1:{int(port)}"
        self.token = (root / "data" / "agent-token").read_text().strip()
        self.timeout = 15

    def call(self, path, payload=None):
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode()
        request = Request(self.base + path, data=body, headers={
            "X-Agent-Token": self.token, "Content-Type": "application/json"})
        with urlopen(request, timeout=self.timeout) as response:
            return json.load(response)

    def status(self, state, message, **fields):
        return self.call("/api/bridge/status", {"provider": "wxauto4", "state": state,
            "message": message, "collectorHeartbeatAt": datetime.now(CN).isoformat(), **fields})


def group_name(info):
    if not isinstance(info, dict):
        return None
    if info.get("chat_type", info.get("type")) != "group":
        return None
    name = info.get("chat_name", info.get("name"))
    if not isinstance(name, str) or not name.strip() or len(name) > 120 or "…" in name or "..." in name:
        return None
    return name


def timestamp(value):
    # Only accept a complete date. UI timestamps with missing dates stay unknown.
    if isinstance(value, datetime):
        return (value if value.tzinfo else value.replace(tzinfo=CN)).isoformat()
    if isinstance(value, str) and len(value) >= 10:
        try:
            parsed = datetime.fromisoformat(value)
            return (parsed if parsed.tzinfo else parsed.replace(tzinfo=CN)).isoformat()
        except ValueError:
            pass
    return None


def normalize_messages(items, group):
    messages, latest_time, seen = [], None, set()
    for item in items:
        kind = getattr(item, "type", "")
        if kind == "time":
            latest_time = timestamp(getattr(item, "time", None))
            continue
        if kind not in ("text", "file"):
            continue  # No downloading attachments, OCR, voice transcription or links.
        text = getattr(item, "content", None)
        if not isinstance(text, str) or not text.strip() or len(text) > 20000:
            continue
        sender = str(getattr(item, "sender", "") or "未识别")[:120]
        sent_at = timestamp(getattr(item, "time", None)) or latest_time
        key = hashlib.sha256("\n".join([group, sender, sent_at or "", text]).encode()).hexdigest()[:24]
        if key in seen:
            continue
        seen.add(key)
        messages.append({"id": key, "sender": sender, "text": text, "sentAt": sent_at})
    return messages[-300:]


class WxProvider:
    def __init__(self):
        from wxauto4 import WxParam, WeChat
        WxParam.TELEMETRY_ENABLED = False
        WxParam.ENABLE_FILE_LOGGER = False
        self.wx = WeChat(start_listener=False, resize=False, debug=False, ads=False)

    def online(self):
        return bool(self.wx.IsOnline())

    def discover(self):
        # GetSession exposes only currently loaded sessions; never open them to
        # infer their type. A friend's name containing '群' is not a group marker.
        names = set()
        for session in self.wx.GetSession():
            name = group_name(getattr(session, "info", None))
            if name:
                names.add(name)
        name = group_name(self.wx.ChatInfo())
        if name:
            names.add(name)
        for chat in self.wx.GetAllSubWindow():
            name = group_name(chat.ChatInfo())
            if name:
                names.add(name)
        return sorted(names)

    def read_group(self, name):
        # Only called for server-provided, user-enabled, verified group names.
        self.wx.ChatWith(name, exact=True, force=False)
        if group_name(self.wx.ChatInfo()) != name:
            raise ValueError("会话名称或群聊身份未核实，已跳过读取")
        return normalize_messages(self.wx.GetAllMessage(), name)


def sync_selected(bridge, provider, context):
    if not context.get("syncEnabled"):
        bridge.status("paused", "群聊整理已暂停；日历和提醒继续运行")
        return
    if not context.get("categories"):
        bridge.status("ready", "尚未选择信息类型；消息读取已暂停")
        return
    selected = [g["name"] for g in context.get("groups", []) if g.get("enabled")]
    if not selected:
        bridge.status("ready", "请选择群聊和信息类型，保存后开始整理")
        return
    known = {m["id"] for m in context.get("recentMessages", [])}
    total = 0
    for name in selected:
        # Recheck settings between groups: removing a group takes effect before
        # the next read; the server rechecks once more before committing data.
        current = bridge.call("/api/bridge/context")
        if not current.get("syncEnabled") or not current.get("categories"):
            break
        if not any(g.get("name") == name and g.get("enabled") for g in current.get("groups", [])):
            continue
        messages = [m for m in provider.read_group(name) if m["id"] not in known]
        if messages:
            bridge.call("/api/import", {"group": name, "messages": messages, "extraction": "local"})
            total += len(messages)
            known.update(m["id"] for m in messages)
    bridge.status("ready", f"本轮整理完成，读取到 {total} 条新文字或文件消息", lastCheckedAt=datetime.now(CN).isoformat())


def run(once=False, interval=60, provider_factory=WxProvider):
    bridge, provider, discovery_request, sync_request, next_sync = Bridge(), None, None, None, 0
    discovered = False
    while True:
        try:
            context = bridge.call("/api/bridge/context")
            status = context.get("bridgeStatus", {})
            if status.get("backgroundOnly") and not status.get("backgroundReadVerified"):
                # A logged-in process is not proof of a background message connection.
                # Do not initialize a UI SDK that may restore or switch windows.
                if status.get("lastCheckOutcome") != "background_unsupported":
                    bridge.status("blocked", "后台接入尚未通过验证；已保存选择，但尚未执行后台消息整理", lastCheckOutcome="background_unsupported")
                if once:
                    return
                time.sleep(max(10, interval))
                continue
            if context.get("bridgeStatus", {}).get("provider") in ("computer-use", "local-db"):
                # UI sampling is performed by the authorized Codex heartbeat.
                # Never compete with it for the WeChat window.
                if once:
                    return
                time.sleep(max(10, interval))
                continue
            probe_file = ROOT / "data" / "wechat-probe.json"
            probe = json.loads(probe_file.read_text(encoding="utf-8")) if probe_file.exists() else {}
            if probe.get("phase") != "online" or not probe.get("online"):
                bridge.status("blocked", "采集库尚未通过微信兼容性检查，真实消息同步尚未就绪")
            else:
                provider = provider or provider_factory()
                if not provider.online():
                    bridge.status("login_required", "微信未登录或连接已断开，请在微信中完成登录")
                    provider = None
                else:
                    context = bridge.call("/api/bridge/context")
                    request = context.get("discoveryRequestedAt")
                    if not discovered or request != discovery_request:
                        names = provider.discover()
                        if names:
                            bridge.call("/api/bridge/discover", {"groups": names, "complete": False,
                                "message": "已发现可核实的群聊，请在这里勾选。免费接口无法保证列出全部群聊。"})
                        elif not context.get("groups"):
                            bridge.status("blocked", "微信连接可用，但免费接口未提供可核实的群列表；群聊发现尚未完成")
                        discovery_request, discovered = request, True
                    if (time.monotonic() >= next_sync or context.get("syncRequestedAt") != sync_request) and context.get("groups"):
                        sync_selected(bridge, provider, bridge.call("/api/bridge/context"))
                        sync_request = context.get("syncRequestedAt")
                        next_sync = time.monotonic() + 1800
        except (HTTPError, URLError):
            # Do not log tokens, message text or server response bodies.
            pass
        except Exception as exc:
            provider = None
            try:
                bridge.status("blocked", "当前微信版本或采集接口不可用，已停止消息读取", errorType=type(exc).__name__)
            except (HTTPError, URLError):
                pass
        if once:
            return
        time.sleep(max(10, interval))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--once", action="store_true")
    parser.add_argument("--interval", type=int, default=60)
    args = parser.parse_args()
    run(args.once, args.interval)
