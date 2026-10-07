"""Read uploaded documents in memory; never execute macros, formulas or links."""
import base64
import io
import json
from pathlib import Path
import sys
import subprocess
import re
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor'))
MAX_TEXT = 120_000
MAX_XML = 20_000_000


def xml(archive, name):
    info = archive.getinfo(name)
    if info.file_size > MAX_XML:
        raise ValueError('文件解压后过大，请拆成较小的文件再导入')
    content = archive.read(name)
    if b'<!DOCTYPE' in content or b'<!ENTITY' in content:
        raise ValueError('文件含不支持的 XML 声明，请另存为普通文档')
    return ET.fromstring(content)


def check_zip(archive):
    entries = archive.infolist()
    if len(entries) > 5000 or sum(i.file_size for i in entries) > 40_000_000:
        raise ValueError('文件解压后过大，请拆成较小的文件再导入')


def text_nodes(node, namespace):
    return ''.join(n.text or '' for n in node.iter(f'{{{namespace}}}t'))


def read_docx(data):
    ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        check_zip(archive)
        document = xml(archive, 'word/document.xml')
        lines = []
        for p in document.iter(f'{{{ns}}}p'):
            line = ''.join((n.text or '') if n.tag == f'{{{ns}}}t' else '\t' if n.tag == f'{{{ns}}}tab' else '\n' if n.tag == f'{{{ns}}}br' else '' for n in p.iter())
            if line.strip():
                lines.append(line)
        return '\n'.join(lines)


def read_xlsx(data):
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    relns = 'http://schemas.openxmlformats.org/package/2006/relationships'
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        check_zip(archive)
        book = xml(archive, 'xl/workbook.xml')
        date1904 = any(n.get('date1904') in ('1', 'true') for n in book.iter(f'{{{ns}}}workbookPr'))
        relations = {r.get('Id'): r.get('Target') for r in xml(archive, 'xl/_rels/workbook.xml.rels').iter(f'{{{relns}}}Relationship') if r.get('TargetMode') != 'External'}
        strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            strings = [text_nodes(n, ns) for n in xml(archive, 'xl/sharedStrings.xml').findall(f'{{{ns}}}si')]
        date_styles = set()
        if 'xl/styles.xml' in archive.namelist():
            import re
            styles = xml(archive, 'xl/styles.xml')
            custom = {int(n.get('numFmtId')): n.get('formatCode', '') for n in styles.iter(f'{{{ns}}}numFmt')}
            xfs = styles.find(f'{{{ns}}}cellXfs')
            for i, xf in enumerate(xfs if xfs is not None else []):
                fmt_id = int(xf.get('numFmtId', '0'))
                fmt = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', '', custom.get(fmt_id, ''))
                if 14 <= fmt_id <= 22 or 27 <= fmt_id <= 36 or 45 <= fmt_id <= 47 or 50 <= fmt_id <= 58 or re.search(r'[ymdhis]', fmt, re.I):
                    date_styles.add(i)
        lines, cells = [], 0
        for sheet in book.iter(f'{{{ns}}}sheet'):
            rid = sheet.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
            target = relations.get(rid, '')
            filename = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            if filename not in archive.namelist():
                continue
            lines.append(f"【工作表：{sheet.get('name', '未命名')}】")
            for row in xml(archive, filename).iter(f'{{{ns}}}row'):
                values = []
                for cell in row.findall(f'{{{ns}}}c'):
                    cells += 1
                    if cells > 100_000:
                        raise ValueError('表格单元格过多，请拆分后导入')
                    kind = cell.get('t')
                    value = cell.find(f'{{{ns}}}v')
                    value = value.text or '' if value is not None else ''
                    if kind == 's':
                        value = strings[int(value)] if value else ''
                    elif kind == 'inlineStr':
                        value = text_nodes(cell, ns)
                    elif kind == 'b':
                        value = '是' if value == '1' else '否'
                    elif kind != 'd' and value and int(cell.get('s', '-1')) in date_styles:
                        serial = float(value)
                        if 0 <= serial < 2_958_466:
                            base = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
                            moment = base + timedelta(days=serial)
                            value = moment.isoformat(sep=' ', timespec='minutes') if serial % 1 else moment.date().isoformat()
                    if value:
                        values.append(f"{cell.get('r', '')}: {value}")
                if values:
                    lines.append(' | '.join(values))
        return '\n'.join(lines)


def read_pdf(data):
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    if reader.is_encrypted:
        raise ValueError('暂不支持加密 PDF，请先解除文件密码再导入')
    if len(reader.pages) > 200:
        raise ValueError('PDF 超过 200 页，请拆分后导入')
    lines, length = [], 0
    for i, page in enumerate(reader.pages, 1):
        content = page.get_contents()
        if content and len(content.get_data()) > MAX_XML:
            raise ValueError('PDF 页面过大，请导出较小的文本版 PDF')
        text = page.extract_text() or ''
        length += len(text)
        if length > MAX_TEXT:
            raise ValueError('文件文字超过 12 万字，请拆分后导入')
        if text.strip():
            lines.append(f'【第 {i} 页】\n{text}')
    if not lines:
        raise ValueError('PDF 没有可提取的文字，扫描件请先进行文字识别再导入')
    return '\n'.join(lines)


def read_text(data):
    if data.startswith((b'\xff\xfe', b'\xfe\xff')):
        return data.decode('utf-16')
    for encoding in ('utf-8-sig', 'gb18030'):
        try:
            text = data.decode(encoding)
            if '\0' in text:
                raise ValueError('文件不是可读取的文字文件，请另存为 UTF-8 文本')
            return text
        except UnicodeError:
            continue
    raise ValueError('无法识别文字编码，请另存为 UTF-8 文本再导入')


def read_image(data):
    helper = Path(__file__).with_name('read-image-text.ps1')
    try:
        process = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', str(helper)], input=json.dumps({'content': base64.b64encode(data).decode('ascii')}), capture_output=True, encoding='utf-8', errors='replace', timeout=20, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0)
        result = json.loads(process.stdout.strip())
        if result.get('error'):
            raise ValueError(result['error'])
        recognized = re.sub(r'(?<=[\u3400-\u9fff\d]) +(?=[\u3400-\u9fff\d：:])', '', result['text'])
        recognized = re.sub(r'(?<=\d)\s*：\s*(?=\d)', ':', recognized)
        return recognized
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError):
        raise ValueError('图片文字识别未就绪或超时，请改用文字文件')


def extract(extension, data):
    if len(data) > 10 * 1024 * 1024:
        raise ValueError('单个文件不能超过 10MB')
    if extension == '.pdf':
        text = read_pdf(data)
    elif extension == '.docx':
        text = read_docx(data)
    elif extension == '.xlsx':
        text = read_xlsx(data)
    elif extension in ('.txt', '.md', '.csv'):
        text = read_text(data)
    elif extension in ('.png', '.jpg', '.jpeg'):
        text = read_image(data)
    else:
        raise ValueError('请选择 PDF、DOCX、XLSX、TXT、MD、CSV、PNG 或 JPG 文件')
    text = text.replace('\r\n', '\n').strip()
    if not text:
        raise ValueError('文件中没有可整理的文字')
    if len(text) > MAX_TEXT:
        raise ValueError('文件文字超过 12 万字，请拆分后导入')
    return text


if __name__ == '__main__':
    try:
        payload = json.load(sys.stdin)
        result = {'text': extract(payload['extension'], base64.b64decode(payload['content'], validate=True))}
    except ValueError as error:
        result = {'error': str(error)}
    except Exception:
        result = {'error': '文件损坏或格式不受支持，请另存为新的文件再导入'}
    print(json.dumps(result, ensure_ascii=False))
