"""Reviewed historical NVIDIA cash flow rows, absent from current CompanyFacts.

Original consolidated statement: purchases related to property and equipment
and intangible assets, USD millions, shown as outflows. Preserve positive
acquisition payments for CapEx and pin the original document checksum.
"""
import hashlib
import html
import re
import sys
from datetime import date
from .models import Fact

# Exact source table cells; YTD, not inferred quarterly allocations.
DOCUMENTS = [
    ('2023-02-24','0001045810-23-000017','nvda-20230129.htm','b948321da2565b4f64079c0e5402df22bf0038006fe9163fe57df41fa0c7dd62',2023,'10-K',
     [('2022-01-31','2023-01-29',1833),('2021-02-01','2022-01-30',976),('2020-01-27','2021-01-31',1128)]),
    ('2022-11-18','0001045810-22-000166','nvda-20221030.htm','3b19dbb1ca5ffdabbb1566e690b49886fd0d05ea8264d2befa5b222f6c9b1fc9',2023,'10-Q',
     [('2022-01-31','2022-10-30',1324),('2021-02-01','2021-10-31',703)]),
    ('2022-08-31','0001045810-22-000147','nvda-20220731.htm','f9e25e14ce80611acc4780cfe43302c399fc1f104442710bf5f7041b3908e7ed',2023,'10-Q',
     [('2022-01-31','2022-07-31',794),('2021-02-01','2021-08-01',481)]),
    ('2022-05-27','0001045810-22-000079','nvda-20220501.htm','6fab293ff19b776f7f9c5fac0028bcb041ebd865fef5d30ad402e4af3adc517b',2023,'10-Q',
     [('2022-01-31','2022-05-01',361),('2021-02-01','2021-05-02',298)]),
]


LABEL='Purchases related to property and equipment and intangible assets'


def row_still_present(content: bytes, rows) -> bool:
    """SEC 偶爾重新產生舊申報的 HTML（位元組改變、數字不變）。
    檢查覆核過的那一列與每個數字是否仍在原文件同一列中。"""
    text=html.unescape(re.sub(r'<[^>]+>',' ',content.decode('utf-8','ignore')))
    text=re.sub(r'\s+',' ',text.replace('\xa0',' '))
    for m in re.finditer(re.escape(LABEL),text,flags=re.I):
        window=text[m.end():m.end()+160]
        if all(re.search(rf'(?<![\d,.]){re.escape(f"{v:,}")}(?![\d,.])',window) for _,_,v in rows):
            return True
    return False


def reviewed_facts(client=None):
    result=[]
    for filed,acc,name,digest,fy,form,rows in DOCUMENTS:
        source=f"https://www.sec.gov/Archives/edgar/data/1045810/{acc.replace('-','')}/{name}"
        note='Original document SHA256: '+digest
        if client:
            content=client.get_bytes(source)
            current=hashlib.sha256(content).hexdigest()
            if current!=digest:
                if not row_still_present(content,rows):
                    raise ValueError(f'NVIDIA historical cash statement changed and reviewed values not found: {name}; review required')
                print(f'::warning::NVIDIA {name} checksum changed ({current[:12]}); reviewed row values still match the document',file=sys.stderr)
                note+=f'; current SHA256 {current} (values re-verified in document)'

        for start,end,millions in rows:
            result.append(Fact(metric='capex',value=millions*1000000,unit='USD',start=start,end=end,filed=filed,accession=acc,
                tag='disclosure:nvda.productive_assets',basis='0001045810:productive-assets-capex',report_fiscal_year=fy,
                reporting_basis='US GAAP',source=source,form=form,
                lineage=['Reviewed consolidated cash flow row: Purchases related to property and equipment and intangible assets',
                    'USD millions; acquisition cash outflow displayed in parentheses; positive CapEx convention', note]))
    return result


def apply_basis(facts):
    return [f.model_copy(update={'basis':'0001045810:productive-assets-capex'}) if f.metric=='capex' and f.tag in {'us-gaap:PaymentsToAcquireProductiveAssets','disclosure:nvda.productive_assets'} else f for f in facts]
