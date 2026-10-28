"""Ordered semantic alternatives; never sum alternative tags.

Custom namespace tags require an explicitly reviewed per-company override.
Missing taxonomy concepts remain missing, including SoFi net revenue if it is
only in a custom filing extension. Do not substitute interest income for revenue.
"""
METRICS = {
    "revenue": ("USD", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]),
    "gross_profit": ("USD", ["GrossProfit"]),
    "cost_revenue": ("USD", ["CostOfRevenue", "CostOfGoodsAndServicesSold"]),
    "operating_income": ("USD", ["OperatingIncomeLoss"]),
    "net_income": ("USD", ["NetIncomeLoss", "ProfitLoss"]),
    "eps": ("USD/shares", ["EarningsPerShareDiluted"]),
    "assets": ("USD", ["Assets"]),
    "liabilities": ("USD", ["Liabilities"]),
    "equity": ("USD", ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]),
    "cash": ("USD", ["CashAndCashEquivalentsAtCarryingValue"]),
    "ocf": ("USD", ["NetCashProvidedByUsedInOperatingActivities"]),
    "icf": ("USD", ["NetCashProvidedByUsedInInvestingActivities"]),
    "financing_cf": ("USD", ["NetCashProvidedByUsedInFinancingActivities"]),
    "capex": ("USD", ["PaymentsToAcquirePropertyPlantAndEquipment"]),
    "sbc": ("USD", ["ShareBasedCompensation"]),
    "shares": ("shares", ["CommonStockSharesOutstanding"]),
    "deposits": ("USD", ["Deposits"]),
    "allowance": ("USD", ["FinancingReceivableAllowanceForCreditLossExcludingAccruedInterestAfterAdjustmentForTimeValue"]),
    "net_interest_income": ("USD", ["InterestIncomeExpenseNet"]),
}
INSTANT = {"assets", "liabilities", "equity", "cash", "shares", "deposits", "allowance", "members", "products", "cet1"}

IFRS_METRICS = {
    "revenue": ["Revenue"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["ProfitLossFromOperatingActivities"],
    "net_income": ["ProfitLossAttributableToOwnersOfParent"],
    "eps": ["DilutedEarningsLossPerShare"],
    "assets": ["Assets"],
    "liabilities": ["Liabilities"],
    "equity": ["EquityAttributableToOwnersOfParent"],
    "cash": ["CashAndCashEquivalents"],
    "ocf": ["CashFlowsFromUsedInOperatingActivities"],
    "icf": ["CashFlowsFromUsedInInvestingActivities"],
    "financing_cf": ["CashFlowsFromUsedInFinancingActivities"],
    "capex": ["PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities"],
    "sbc": ["AdjustmentsForSharebasedPayments"],
}


def extract(companyfacts, cik, overrides=None, *, currency="USD", standard="US GAAP"):
    from .models import Fact
    result = []
    for metric, (unit, tags) in METRICS.items():
        if standard == "IFRS":
            tags = IFRS_METRICS.get(metric, [])
        namespace = "ifrs-full" if standard == "IFRS" else "us-gaap"
        candidates = (overrides or {}).get(metric, [f"{namespace}:{t}" for t in tags])
        unit = unit.replace("USD", currency)
        forms = {"20-F", "20-F/A", "6-K", "6-K/A"} if standard == "IFRS" else {"10-K", "10-Q", "10-K/A", "10-Q/A"}
        # Issuers can migrate between reviewed equivalent candidates. Select one
        # current concept for the whole series, never splice older concepts in.
        def latest(tag):
            ns, local = tag.split(":", 1)
            values = companyfacts.get("facts", {}).get(ns, {}).get(local, {}).get("units", {}).get(unit, [])
            return max((r["end"] for r in values if r.get("form") in forms), default="")
        candidates = sorted(candidates, key=latest, reverse=True)
        bridged = metric == "revenue" and cik in {"0001652044","0001045810","0001318605"}
        if bridged:
            snapshots=[]
            for tag in candidates:
                ns, local=tag.split(':',1)
                values=companyfacts.get('facts',{}).get(ns,{}).get(local,{}).get('units',{}).get(unit,[])
                periods={}
                for r in sorted(values,key=lambda r:(r['filed'],r['accn'])):
                    if r.get('form') in forms and r['end']>='2020-01-01':periods[(r.get('start'),r['end'])]=r['val']
                if periods:snapshots.append(periods)
            for i,a in enumerate(snapshots):
                for b in snapshots[i+1:]:
                    common=set(a)&set(b)
                    if not common or any(a[k]!=b[k] for k in common):
                        raise ValueError(f"Revenue concept migration requires review: {cik}")
        # Choose one concept per metric, never splice different accounting bases.
        for tag in candidates:
            namespace, local = tag.split(":", 1)
            rows = companyfacts.get("facts", {}).get(namespace, {}).get(local, {}).get("units", {}).get(unit, [])
            rows = [r for r in rows if r.get("form") in forms]
            if not rows:
                continue
            for row in rows:
                accession = row["accn"]
                result.append(Fact(metric=metric, value=row["val"], unit=unit,
                    start=row.get("start"), end=row["end"], filed=row["filed"], accession=accession,
                    tag=tag, form=row["form"],
                    basis=f"{cik}:consolidated-revenue" if bridged else None,
                    report_fiscal_year=row.get('fy'),
                    reporting_basis='IFRS (IASB)' if standard=='IFRS' else 'US GAAP',
                    source=f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.html"))
            if not bridged:
                break
    return result
