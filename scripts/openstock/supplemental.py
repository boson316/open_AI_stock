"""Reviewed SoFi SEC earnings-release adapter, failing closed on layout changes.

Extracts exact disclosed rows and period headings, never narrative numbers.
Non-XBRL disclosure rows use disclosure: tags (not invented XBRL tags).
Only SoFi's calendar quarters are supported by this adapter.
"""
import calendar
from datetime import datetime
import re
from .inline import InlineParser
from .models import Fact

EQUIVALENTS = {
    "disclosure:sofi.revenue": "us-gaap:RevenuesNetOfInterestExpense",
    "disclosure:sofi.net_income": "us-gaap:NetIncomeLoss",
    "disclosure:sofi.eps": "us-gaap:EarningsPerShareDiluted",
    "disclosure:sofi.net_interest_income": "us-gaap:InterestIncomeExpenseNet",
}


def basis(fact):
    return EQUIVALENTS.get(fact.tag, fact.tag)


def clean(text):
    return " ".join(text.replace("\u2009", " ").split())


def numbers(cells):
    values = []
    for cell in cells:
        cell = clean(cell)
        if re.fullmatch(r"\(?-?[\d,]+(?:\.\d+)?\)?", cell):
            negative = cell.startswith("(")
            v = float(cell.replace(",", "").strip("()"))
            values.append(-v if negative else v)
        elif cell in {"—", "–"}:
            values.append(None)
    return values


def parse_release(content, *, source, accession, filed):
    if not source.startswith("https://www.sec.gov/Archives/edgar/data/1818874/"):
        raise ValueError("Only SoFi official SEC release accepted")
    parser = InlineParser()
    parser.feed(content)
    facts = []
    def add(metric, value, end, unit="USD", start=None):
        if value is None:
            return
        facts.append(Fact(metric=metric,value=value,unit=unit,start=start,end=end,filed=filed,accession=accession,
            tag=f"disclosure:sofi.{metric}",source=source,form="8-K",lineage=["Official earnings release table; non-XBRL disclosure"]))
    def quarter_start(end):
        d = datetime.strptime(end,"%Y-%m-%d")
        if d.month not in {3,6,9,12} or d.day != calendar.monthrange(d.year,d.month)[1]:
            raise ValueError("Unsupported fiscal calendar")
        return f"{d.year}-{d.month-2:02d}-01"
    for table in parser.root.walk("table"):
        rows = [[clean(c.text()) for c in row.children if c.tag in {"td","th"}] for row in table.walk("tr")]
        # Quarterly average-balance schedule: NIM is disclosed, not estimated.
        quarter_heads = [re.fullmatch(r"Three Months Ended ((?:March|June|September|December) \d{1,2}, \d{4})",c) for row in rows[:3] for c in row]
        qdates = [datetime.strptime(m[1],"%B %d, %Y").date().isoformat() for m in quarter_heads if m]
        if len(qdates)==2:
            for row in rows:
                if row and row[0]=="Net interest margin" and len(numbers(row[1:]))==2:
                    for end,v in zip(qdates,numbers(row[1:])):
                        add("nim",None if v is None else v/100,end,"pure",quarter_start(end))
        # Capital adequacy schedule: select parent-company CET1 explicitly.
        capital_dates=[c for row in rows[:3] for c in row if re.fullmatch(r"(?:March|June|September|December) \d{1,2}, \d{4}",c)]
        if len(capital_dates)==2 and any("Required Minimum" in c for row in rows[:4] for c in row):
            parent=False
            for row in rows:
                if row and row[0]=="SoFi Technologies":
                    parent=True
                if parent and row and row[0]=="CET1 risk-based capital":
                    vals=numbers(row[1:])
                    if len(vals)==5:
                        for end,v in zip(capital_dates,[vals[1],vals[3]]):
                            add("cet1",None if v is None else v/100,datetime.strptime(end,"%B %d, %Y").date().isoformat(),"pure")
                    break
        # Historical quarterly table and member table have explicit full dates.
        header = next(([c for c in row if re.fullmatch(r"(?:March|June|September|December) \d{1,2}, \d{4}", c)] for row in rows if sum(bool(re.fullmatch(r"(?:March|June|September|December) \d{1,2}, \d{4}",c)) for c in row) >= 4), [])
        if header:
            dates = [datetime.strptime(x,"%B %d, %Y").date().isoformat() for x in header]
            consolidated = False
            for row in rows:
                if not row:
                    continue
                label = row[0]
                if label == "Consolidated":
                    consolidated = True
                elif label in {"Lending","Technology Platform","Financial Services","Corporate/Other"}:
                    consolidated = False
                values = numbers(row[1:])
                if len(values) != len(dates):
                    continue
                if label in {"Members","Total Products"}:
                    for end,v in zip(dates,values):
                        add("members" if label=="Members" else "products",v,end,"count")
                if consolidated and label in {"Total net revenue","Net income","Net interest income"}:
                    metric={"Total net revenue":"revenue","Net income":"net_income","Net interest income":"net_interest_income"}[label]
                    for end,v in zip(dates,values):
                        add(metric,None if v is None else v*1000,end,start=quarter_start(end))
        # GAAP consolidated income statement: 4 numeric columns, quarter pair
        # followed by annual pair. Never use adjusted or segment statements.
        text = " ".join(" ".join(row) for row in rows[:4])
        has_eps = any(row and row[0] in {"Earnings per share – diluted","Earnings per share — diluted"} for row in rows)
        period = re.search(r"Three Months Ended (March|June|September|December) (\d{1,2}),", text)
        year_row = next(([c for c in row if re.fullmatch(r"20\d{2}",c)] for row in rows[:5] if sum(bool(re.fullmatch(r"20\d{2}",c)) for c in row)==4), [])
        if has_eps and period and len(year_row)==4 and re.search(r"(?:Year|Six Months|Nine Months) Ended",text):
            for row in rows:
                if not row:
                    continue
                metric = {"Total net revenue":"revenue","Net income":"net_income","Earnings per share – diluted":"eps","Earnings per share — diluted":"eps"}.get(row[0])
                vals = numbers(row[1:])
                if not metric or len(vals)!=4:
                    continue
                for year,v in zip(year_row[:2],vals[:2]):
                    end = datetime.strptime(f"{period[1]} {period[2]}, {year}","%B %d, %Y").date().isoformat()
                    add(metric,None if v is None else v*(1 if metric=="eps" else 1000),end,"USD/shares" if metric=="eps" else "USD",quarter_start(end))
    unique = {(f.metric,f.start,f.end,f.value):f for f in facts}
    if not unique:
        raise ValueError("No recognized SoFi release tables; refusing to guess")
    return list(unique.values())


def fetch_releases(client, limit=4):
    from .history import filings
    submissions=filings(client,"0001818874")
    result=[]
    selected=[i for i,f in enumerate(submissions["form"]) if f=="8-K" and "2.02" in submissions["items"][i]][:limit]
    for i in selected:
        acc=submissions["accessionNumber"][i]
        base=f"https://www.sec.gov/Archives/edgar/data/1818874/{acc.replace('-','')}/"
        index=client.get_json(base+"index.json")
        names=[x["name"] for x in index["directory"]["item"] if "earningsrelease" in x["name"].lower() and x["name"].endswith(".htm")]
        if len(names)!=1:
            raise ValueError("Unrecognized earnings release exhibit; retaining previous dataset")
        source=base+names[0]
        result.extend(parse_release(client.get_bytes(source).decode(),source=source,accession=acc,filed=submissions["filingDate"][i]))
    return result
