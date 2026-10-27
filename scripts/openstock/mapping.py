"""Ordered semantic alternatives; never sum alternative tags.

Custom namespace tags require an explicitly reviewed per-company override.
Missing taxonomy concepts remain missing, including SoFi net revenue if it is
only in a custom filing extension. Do not substitute interest income for revenue.
"""
METRICS = {
    "revenue": ("USD", ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]),
    "gross_profit": ("USD", ["GrossProfit"]),
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


def extract(companyfacts, cik, overrides=None):
    from .models import Fact
    result = []
    for metric, (unit, tags) in METRICS.items():
        candidates = (overrides or {}).get(metric, [f"us-gaap:{t}" for t in tags])
        # Choose one concept per metric, never splice different accounting bases.
        for tag in candidates:
            namespace, local = tag.split(":", 1)
            rows = companyfacts.get("facts", {}).get(namespace, {}).get(local, {}).get("units", {}).get(unit, [])
            rows = [r for r in rows if r.get("form") in {"10-K", "10-Q", "10-K/A", "10-Q/A"}]
            if not rows:
                continue
            for row in rows:
                accession = row["accn"]
                result.append(Fact(metric=metric, value=row["val"], unit=unit,
                    start=row.get("start"), end=row["end"], filed=row["filed"], accession=accession,
                    tag=tag, form=row["form"],
                    source=f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.html"))
            break
    return result
