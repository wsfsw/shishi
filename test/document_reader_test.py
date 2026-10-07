import io
import sys
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from read_document import extract


def archive(entries):
    out = io.BytesIO()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, content in entries.items():
            z.writestr(name, content)
    return out.getvalue()


class ReaderTest(unittest.TestCase):
    def test_text_encodings(self):
        text = '2026年10月8日14:30 参加评审'
        for ext in ('.txt', '.md', '.csv'):
            for encoding in ('utf-8-sig', 'gb18030', 'utf-16'):
                self.assertEqual(extract(ext, text.encode(encoding)), text)
        with self.assertRaisesRegex(ValueError, '没有'):
            extract('.txt', b'  ')
        with self.assertRaisesRegex(ValueError, '12'):
            extract('.txt', b'a' * 120001)

    def test_docx_paragraphs_and_tables(self):
        content = '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>会议</w:t></w:r><w:r><w:t> 2026年10月8日</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>提交材料</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>'
        text = extract('.docx', archive({'word/document.xml': content}))
        self.assertEqual(text, '会议 2026年10月8日\n提交材料')

    def test_xlsx_names_strings_dates_and_cached_values(self):
        ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
        data = archive({
            'xl/workbook.xml': f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="活动表" sheetId="1" r:id="r1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>',
            'xl/sharedStrings.xml': f'<sst xmlns="{ns}"><si><t>参加评审</t></si></sst>',
            'xl/styles.xml': f'<styleSheet xmlns="{ns}"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
            'xl/worksheets/sheet1.xml': f'<worksheet xmlns="{ns}"><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" s="1"><v>46303</v></c><c r="C1" t="inlineStr"><is><t>明天提交</t></is></c><c r="D1"><f>HYPERLINK("http://invalid")</f><v>123</v></c></row></sheetData></worksheet>'
        })
        text = extract('.xlsx', data)
        self.assertIn('工作表：活动表', text)
        self.assertIn('A1: 参加评审', text)
        self.assertIn('B1: 2026-10-08', text)
        self.assertIn('C1: 明天提交', text)
        self.assertIn('D1: 123', text)
        self.assertNotIn('invalid', text)

    def test_zip_limits(self):
        with self.assertRaisesRegex(ValueError, '解压'):
            extract('.docx', archive({'word/document.xml': 'a' * 40_000_001}))

    def test_pdf_text_and_scans(self):
        from pypdf import PdfWriter
        from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject
        writer = PdfWriter()
        page = writer.add_blank_page(width=300, height=200)
        font = DictionaryObject({NameObject('/Type'): NameObject('/Font'), NameObject('/Subtype'): NameObject('/Type1'), NameObject('/BaseFont'): NameObject('/Helvetica')})
        page[NameObject('/Resources')] = DictionaryObject({NameObject('/Font'): DictionaryObject({NameObject('/F1'): writer._add_object(font)})})
        stream = DecodedStreamObject();stream.set_data(b'BT /F1 12 Tf 20 100 Td (Meeting 2026-10-08 14:30) Tj ET')
        page[NameObject('/Contents')] = writer._add_object(stream)
        out = io.BytesIO();writer.write(out)
        self.assertIn('Meeting 2026-10-08 14:30', extract('.pdf', out.getvalue()))
        blank = PdfWriter();blank.add_blank_page(width=100, height=100)
        out = io.BytesIO();blank.write(out)
        with self.assertRaisesRegex(ValueError, '扫描件'):
            extract('.pdf', out.getvalue())

    def test_encrypted_pdf(self):
        from pypdf import PdfWriter
        writer = PdfWriter();writer.add_blank_page(width=100, height=100);writer.encrypt('secret')
        out = io.BytesIO();writer.write(out)
        with self.assertRaisesRegex(ValueError, '加密'):
            extract('.pdf', out.getvalue())

    @unittest.skipUnless(sys.platform == 'win32', '本机 Windows 图片文字识别')
    def test_notification_image_ocr(self):
        image = Path(__file__).with_name('fixtures') / 'image-schedule-check.png'
        recognized = extract('.png', image.read_bytes())
        self.assertIn('2026年10月8日14:30', recognized)
        self.assertIn('2026年10月9日', recognized)


if __name__ == '__main__':
    unittest.main()
