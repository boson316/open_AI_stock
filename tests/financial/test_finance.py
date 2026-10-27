"""Synthetic fixtures for arithmetic only; never published as company data."""
from datetime import date
import json
import pytest
from openstock.models import Fact
from openstock.normalize import quarters
from openstock.formulas import cagr, free_cash_flow, growth, pe, ratio, roic, ttm, wacc
from openstock.mapping import extract
from openstock.pipeline import generate
from openstock.sec import SECClient


def fact(value, start, end, **kwargs):
    return Fact(metric="revenue", value=value, unit="USD", start=start, end=end,
        filed=kwargs.pop("filed", "2025-02-28"), accession=kwargs.pop("accession", "test-only"),
        tag=kwargs.pop("tag", "us-gaap:Revenues"), source="https://www.sec.gov/test-fixture", form="10-K", **kwargs)


def test_q4_lineage_and_same_filing():
    ytd = fact(90, "2024-01-01", "2024-09-30")
    year = fact(140, "2024-01-01", "2024-12-31")
    result = quarters([ytd, year])
    assert len(result) == 1
    q4 = result[0]
    assert q4.value == 50 and q4.start == date(2024, 10, 1)
    assert q4.quality == "derived" and len(q4.lineage) == 2


def test_q4_does_not_mix_filing_versions():
    assert quarters([fact(90,"2024-01-01","2024-09-30",accession="old"),fact(140,"2024-01-01","2024-12-31",accession="new")]) == []


@pytest.mark.parametrize("start,end,prior_end",[("2023-10-01","2024-09-30","2024-06-30"),("2023-01-29","2024-02-03","2023-10-28")])
def test_non_calendar_and_53_week(start,end,prior_end):
    result = quarters([fact(80,start,prior_end),fact(110,start,end)])
    assert result[-1].value == 30


def test_restatement_direct_preference_asof_and_dedup():
    old = fact(20,"2024-10-01","2024-12-31",filed="2025-02-01",accession="old")
    new = fact(25,"2024-10-01","2024-12-31",filed="2025-03-01",accession="amended")
    assert quarters([old,new,new])[0].value == 25
    assert quarters([old,new],date(2025,2,10))[0].value == 20
    assert quarters([old],date(2024,12,31)) == []


def test_eps_is_not_additive_ytd():
    a = fact(3,"2024-01-01","2024-09-30").model_copy(update={"metric":"eps","unit":"USD/shares"})
    b = fact(5,"2024-01-01","2024-12-31").model_copy(update={"metric":"eps","unit":"USD/shares"})
    assert quarters([a,b]) == []


def test_unit_and_taxonomy_incompatibility():
    a = fact(90,"2024-01-01","2024-09-30")
    b = fact(140,"2024-01-01","2024-12-31",tag="custom:Revenues")
    assert quarters([a,b]) == []
    assert quarters([a,b.model_copy(update={"tag":a.tag,"unit":"EUR"})]) == []


def test_ttm_contiguous_and_missing():
    fs = [fact(10,"2024-01-01","2024-03-31"),fact(20,"2024-04-01","2024-06-30"),fact(30,"2024-07-01","2024-09-30"),fact(40,"2024-10-01","2024-12-31")]
    assert ttm(fs) == 100
    assert ttm(fs[:3]) is None
    assert ttm([fs[0],fs[0],*fs[2:]]) is None
    assert ttm([*fs[:3],fs[3].model_copy(update={"unit":"EUR"})]) is None


def test_financial_formulas():
    assert free_cash_flow(100,-20) == free_cash_flow(100,20) == 80
    assert free_cash_flow(None,20) is None
    assert pe(10,-1) is None and pe(10,0) is None and pe(10,2) == 5
    assert growth(120,100) == pytest.approx(.2)
    assert growth(-5,-10) is None and ratio(1,0) is None
    assert cagr(100,121,date(2022,1,1),date(2024,1,1)) == pytest.approx(.1,abs=.001)
    assert cagr(-1,1,date(2022,1,1),date(2024,1,1)) is None
    assert roic(100,.2,500) == .16
    assert roic(100,1.1,500) is None
    assert wacc(80,20,.1,.05,.2) == pytest.approx(.088)
    assert wacc(0,0,.1,.05,.2) is None


def raw_company():
    return {"cik":1818874,"facts":{"us-gaap":{"RevenuesNetOfInterestExpense":{"units":{"USD":[{"start":"2024-01-01","end":"2024-03-31","val":100,"filed":"2024-05-01","accn":"test-fixture","form":"10-Q"}]}}}}}


def test_pipeline_schema_export_and_atomic_failure(tmp_path):
    source = tmp_path / "synthetic-test-only.json"
    source.write_text(json.dumps(raw_company()))
    output = tmp_path / "out"
    dataset = generate("SOFI",output,source)
    assert dataset.facts[0].tag == "us-gaap:RevenuesNetOfInterestExpense"
    assert json.loads((output/"catalog.json").read_text())["companies"][0]["status"] == "available"
    original = (output/"SOFI.json").read_bytes()
    source.write_text('{"cik":1}')
    with pytest.raises(ValueError,match="CIK"):
        generate("SOFI",output,source)
    assert (output/"SOFI.json").read_bytes() == original


def test_reviewed_custom_mapping_no_guessing():
    raw = raw_company()
    raw["facts"]["custom"] = {"NetRevenue":raw["facts"]["us-gaap"]["RevenuesNetOfInterestExpense"]}
    assert extract(raw,"0001818874",{"revenue":["custom:NetRevenue"]})[0].tag == "custom:NetRevenue"


def test_sec_cache_and_user_agent(tmp_path,monkeypatch):
    import httpx
    calls=[]
    def get(client,url):
        calls.append(url)
        return httpx.Response(200,json={"test_only":True},request=httpx.Request("GET",url))
    monkeypatch.setattr(httpx.Client,"get",get)
    client=SECClient(tmp_path,user_agent="OpenStock test@local.invalid")
    assert client.get_json("https://data.sec.gov/test") == {"test_only":True}
    assert client.get_json("https://data.sec.gov/test") == {"test_only":True}
    assert len(calls)==1
    with pytest.raises(ValueError): client.get_bytes("https://untrusted.invalid/test")
    with pytest.raises(ValueError): SECClient(tmp_path,user_agent="missing-contact")


def test_sofi_does_not_mislabel_contract_component_as_total_revenue(tmp_path):
    raw = raw_company()
    raw['facts']['us-gaap']['RevenueFromContractWithCustomerExcludingAssessedTax'] = {"units":{"USD":[{"start":"2024-01-01","end":"2024-03-31","val":7,"filed":"2024-05-01","accn":"test-fixture","form":"10-Q"}]}}
    path = tmp_path/'test.json'
    path.write_text(json.dumps(raw))
    d=generate('SOFI',tmp_path/'out',path)
    assert [f.value for f in d.facts if f.metric=='revenue']==[100]


def test_split_adjustment_preserves_pe():
    from openstock.valuation import Split, adjust_per_share
    event = Split(date(2024,6,1),2,"https://issuer.invalid/test-only")
    price = adjust_per_share(100,date(2024,1,1),date(2024,7,1),[event])
    eps = adjust_per_share(5,date(2024,1,1),date(2024,7,1),[event])
    assert price == 50 and eps == 2.5 and pe(price,eps) == 20
    assert adjust_per_share(None,date(2024,1,1),date(2024,7,1),[event]) is None
    with pytest.raises(ValueError): Split(date(2024,6,1),0,"https://issuer.invalid/test-only")


def test_inline_custom_fact_scale_sign_and_dimension_filter():
    from openstock.inline import inline_facts
    html='''<html><xbrli:context id="c"><xbrli:entity><xbrli:identifier>0001818874</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2024-01-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context><xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit><ix:nonFraction name="sofi:ReviewedRevenue" contextRef="c" unitRef="usd" scale="3" sign="-" format="ixt:num-dot-decimal">1,200</ix:nonFraction></html>'''
    args=dict(filed="2024-05-01",accession="test-only",form="10-Q",source="https://www.sec.gov/Archives/edgar/data/1818874/test",cik="0001818874")
    facts=inline_facts(html,{"revenue":["sofi:ReviewedRevenue"]},**args)
    assert facts[0].value == -1200000
    dimensional=html.replace('</xbrli:entity>','<xbrli:segment><xbrldi:explicitMember>sofi:Segment</xbrldi:explicitMember></xbrli:segment></xbrli:entity>')
    assert inline_facts(dimensional,{"revenue":["sofi:ReviewedRevenue"]},**args)==[]


def test_supplemental_disclosed_q4_eps_and_no_adjusted_confusion():
    from openstock.supplemental import parse_release
    html='''<table><tr><td>Three Months Ended December 31,</td><td>Year Ended December 31,</td></tr><tr><td>2025</td><td>2024</td><td>2025</td><td>2024</td></tr><tr><td>Total net revenue</td><td>100</td><td>80</td><td>350</td><td>300</td></tr><tr><td>Net income</td><td>10</td><td>8</td><td>35</td><td>30</td></tr><tr><td>Earnings per share – diluted</td><td>0.10</td><td>0.08</td><td>0.35</td><td>0.30</td></tr><tr><td>Adjusted earnings per share – diluted</td><td>100</td><td>80</td><td>350</td><td>300</td></tr></table>'''
    facts=parse_release(html,source='https://www.sec.gov/Archives/edgar/data/1818874/test-only',accession='test',filed='2026-01-30')
    assert len(facts)==6
    eps=[f for f in facts if f.metric=='eps' and str(f.end)=='2025-12-31'][0]
    assert eps.value==.1 and str(eps.start)=='2025-10-01' and eps.form=='8-K'
    assert eps.tag=='disclosure:sofi.eps' and eps.quality=='reported'
    with pytest.raises(ValueError,match='refusing to guess'):
        parse_release('<p>Unknown layout</p>',source='https://www.sec.gov/Archives/edgar/data/1818874/test-only',accession='test',filed='2026-01-30')


def test_ttm_reviewed_equivalent_disclosure_basis():
    fs=[fact(10,'2024-01-01','2024-03-31'),fact(20,'2024-04-01','2024-06-30'),fact(30,'2024-07-01','2024-09-30'),fact(40,'2024-10-01','2024-12-31')]
    fs=[f.model_copy(update={'tag':'us-gaap:RevenuesNetOfInterestExpense'}) for f in fs]
    fs[-1]=fs[-1].model_copy(update={'tag':'disclosure:sofi.revenue'})
    assert ttm(fs)==100
    fs[-1]=fs[-1].model_copy(update={'tag':'us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax'})
    assert ttm(fs) is None


def test_supplemental_nim_and_parent_cet1_units():
    from openstock.supplemental import parse_release
    html='''<table><tr><td>Three Months Ended September 30, 2026</td><td>Three Months Ended September 30, 2025</td></tr><tr><td>Net interest margin</td><td>6.14</td><td>%</td><td>5.84</td><td>%</td></tr></table><table><tr><td>September 30, 2026</td><td>September 30, 2025</td></tr><tr><td>Amount</td><td>Ratio</td><td>Required Minimum(2)</td></tr><tr><td>SoFi Bank</td></tr><tr><td>CET1 risk-based capital</td><td>1</td><td>99</td><td>1</td><td>99</td><td>7</td></tr><tr><td>SoFi Technologies</td></tr><tr><td>CET1 risk-based capital</td><td>100</td><td>16.9</td><td>80</td><td>20</td><td>7</td></tr></table>'''
    fs=parse_release(html,source='https://www.sec.gov/Archives/edgar/data/1818874/test-only',accession='test',filed='2026-10-27')
    assert [f.value for f in fs if f.metric=='nim']==pytest.approx([.0614,.0584],abs=1e-12)
    assert [f.value for f in fs if f.metric=='cet1']==pytest.approx([.169,.2],abs=1e-12)
    assert all(f.unit=='pure' for f in fs)
