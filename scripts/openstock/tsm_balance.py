"""TSM consolidated TIFRS balance sheets from official SEC 6-K quarterly reports (NTD thousands).

Only the consolidated report (never parent-company-only). Every amount row must
carry one Amount and one % column per balance-sheet date; anything else fails.
Shares outstanding = Capital stock ÷ NT$10 par value (ordinary shares).
"""
import re
from datetime import datetime
from .models import Fact

LABELS = {
    'Cash and cash equivalents': 'cash',
    'Notes and accounts receivable, net': 'receivables',
    'Inventories': 'inventory',
    'Total current assets': 'current_assets',
    'Accounts payable': 'payables',
    'Short-term loans': 'short_borrowings',
    'Long-term liabilities - current portion': 'debt_current',
    'Total current liabilities': 'current_liabilities',
    'Bonds payable': 'bonds',
    'Long-term bank loans': 'bank_loans',
    'Total liabilities': 'liabilities',
    'Capital stock': 'capital',
    'Equity attributable to shareholders of the parent': 'equity',
}
DATE = re.compile(r'(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (20\d{2})')
AMOUNT = re.compile(r'\(?\$?\s*[\d,]+\)?|-')
PAR_VALUE = 10  # NT$ per ordinary share


def _label(cell):
    return re.sub(r'\s*\((?:Note|Notes)[^)]*\)\s*$', '', cell).strip()


def _amount(text):
    t = text.replace('$', '').replace(',', '').strip()
    if t in {'-', '–', '—'}:
        return 0
    if t.startswith('(') and t.endswith(')'):
        return -int(t[1:-1])
    return int(t)


def parse_balance(doc):
    intro = doc.get('intro', '').lower()
    if 'consolidated' not in intro or 'parent company only' in intro:
        return []
    evidence = ' '.join(doc.get('unit_evidence', []))
    if 'CONSOLIDATED BALANCE SHEETS' not in evidence.upper():
        return []
    if 'thousands of new taiwan dollars' not in evidence.lower():
        raise ValueError('TIFRS balance sheet requires explicit NTD thousands evidence')
    found = {}
    dates = None
    total_seen = False
    done = False
    for table in doc['tables']:
        if done:
            break
        if not isinstance(table, list):
            continue
        for row in table[:6]:
            ds = [DATE.fullmatch(c.strip()) for c in row if DATE.fullmatch(c.strip())]
            if len(ds) >= 2:
                dates = [datetime.strptime(' '.join(m.groups()), '%B %d %Y').date() for m in ds]
                total_seen = False
                break
        if not dates:
            continue
        head = ' '.join(' '.join(r) for r in table[:8]).upper()
        if 'MONTHS ENDED' in head or 'CASH FLOWS' in head or 'STATEMENTS OF' in head:
            dates = None  # 損益表、現金流量表或權益變動表：不是資產負債表
            continue
        for row in table:
            cells = [c for c in row if c.strip() not in {'', '$'}]
            if not cells:
                continue
            label = _label(cells[0])
            metric = LABELS.get(label)
            if label == 'TOTAL':
                if total_seen:
                    # 第二個 TOTAL 是負債及權益總計：資產負債表到此結束，後面的附註表格（借款變動等）不再讀取。
                    done = True
                    break
                metric, total_seen = 'assets', True
            if metric is None:
                continue
            values = cells[1:]
            if len(values) != 2 * len(dates) or not all(AMOUNT.fullmatch(v.strip()) for v in values[::2]):
                raise ValueError(f'Unrecognized TSM balance sheet row: {label}: {values}')
            for d, v in zip(dates, values[::2]):
                key = (metric, d)
                amount = _amount(v) * 1000
                if key in found and found[key] != amount:
                    raise ValueError(f'Conflicting TSM balance sheet values: {key}')
                found[key] = amount
    if not found:
        return []
    facts = []
    def fact(metric, value, end, label, extra=()):
        facts.append(Fact(metric=metric, value=value, unit='shares' if metric == 'shares' else 'TWD', start=None, end=end,
            filed=doc['filed'], accession=doc['accession'], tag='disclosure:tsm.tifrs.' + metric, basis='TIFRS',
            reporting_basis='TIFRS', source=doc['source'], form='6-K',
            lineage=[label, *extra, 'Consolidated TIFRS balance sheet; NTD thousands × 1000', 'Original document SHA256: ' + doc['sha256']]))
    for (metric, end), value in sorted(found.items(), key=lambda x: (x[0][1], x[0][0])):
        if metric in {'bonds', 'bank_loans', 'capital'}:
            continue
        fact(metric, value, end, next(k for k, m in LABELS.items() if m == metric) if metric != 'assets' else 'TOTAL (assets)')
    for end in sorted({d for _, d in found}):
        if ('bonds', end) in found:
            fact('long_term_debt', found[('bonds', end)] + found.get(('bank_loans', end), 0), end,
                 'Bonds payable + Long-term bank loans (noncurrent)')
        if ('capital', end) in found:
            fact('shares', found[('capital', end)] / PAR_VALUE, end, 'Capital stock ÷ NT$10 par value',
                 (f'Capital stock: {found[("capital", end)]} TWD',))
    return facts
