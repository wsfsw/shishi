"""Read-only compatibility probe: no chat switching, sending or authentication."""
import argparse
import inspect
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="data/wechat-probe.json")
    parser.add_argument("--status-only", action="store_true", help="Only check online status; do not enumerate conversations")
    args = parser.parse_args()
    result = {"provider": "wxauto4", "phase": "initializing", "online": False}
    try:
        from wxauto4 import WxParam, WeChat
        WxParam.TELEMETRY_ENABLED = False
        WxParam.ENABLE_FILE_LOGGER = False
        # Disable SDK advertisements, automatic listeners and window resizing.
        wx = WeChat(start_listener=False, resize=False, ads=False)
        result["online"] = bool(wx.IsOnline())
        result["phase"] = ("status_only_online" if args.status_only else "online") if result["online"] else "login_required"
        result["methods"] = [n for n in dir(wx) if not n.startswith("_")]
        if result["online"] and not args.status_only:
            sessions = wx.GetSession()
            # Preserve structure only; never expose unselected conversation previews.
            result["sessionCount"] = len(sessions)
            result["sessionSchema"] = [list(s.info.keys()) for s in sessions[:1]]
            result["sessionAttributes"] = [n for n in dir(sessions[0]) if not n.startswith("_")] if sessions else []
            result["supportsRecentGroups"] = callable(getattr(wx, "GetAllRecentGroups", None))
    except Exception as exc:
        result["phase"] = "incompatible_or_unavailable"
        result["errorType"] = type(exc).__name__
        result["error"] = str(exc)[:600]
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    run()
