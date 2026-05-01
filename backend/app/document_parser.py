import io
import pandas as pd
from bs4 import BeautifulSoup
from striprtf.striprtf import rtf_to_text
import docx

def parse_pdf(buffer: bytes) -> str:
    import fitz # PyMuPDF
    doc = fitz.open(stream=buffer, filetype="pdf")
    text = []
    for page in doc:
        text.append(page.get_text())
    return "\n".join(text)

def parse_docx(buffer: bytes) -> str:
    doc = docx.Document(io.BytesIO(buffer))
    return "\n".join([p.text for p in doc.paragraphs])

def parse_csv(buffer: bytes) -> str:
    df = pd.read_csv(io.BytesIO(buffer))
    return df.to_string()

def parse_excel(buffer: bytes) -> str:
    df = pd.read_excel(io.BytesIO(buffer))
    return df.to_string()

def parse_html(buffer: bytes) -> str:
    soup = BeautifulSoup(buffer, "html.parser")
    return soup.get_text(separator="\n", strip=True)

def parse_rtf(buffer: bytes) -> str:
    text = buffer.decode("utf-8", errors="ignore")
    return rtf_to_text(text)

def parse_txt(buffer: bytes) -> str:
    try:
        return buffer.decode("utf-8")
    except UnicodeDecodeError:
        import chardet
        encoding = chardet.detect(buffer)['encoding'] or 'utf-8'
        return buffer.decode(encoding, errors="replace")

def parse_document(buffer: bytes, filename: str, mimetype: str) -> str:
    ext = filename.split(".")[-1].lower() if "." in filename else ""
    
    if ext == "pdf" or mimetype == "application/pdf":
        return parse_pdf(buffer)
    elif ext == "docx" or "wordprocessingml.document" in mimetype:
        return parse_docx(buffer)
    elif ext == "csv" or mimetype == "text/csv":
        return parse_csv(buffer)
    elif ext in ["xlsx", "xls"] or "spreadsheetml" in mimetype:
        return parse_excel(buffer)
    elif ext in ["html", "htm"] or "html" in mimetype:
        return parse_html(buffer)
    elif ext == "rtf" or "rtf" in mimetype:
        return parse_rtf(buffer)
    else:
        # Fallback to plain text
        return parse_txt(buffer)
