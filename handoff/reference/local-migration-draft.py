import json,hashlib
from pathlib import Path
from datetime import datetime,timezone
from openstock.pipeline import COMPANIES,COMPANY_MAPPINGS,atomic_json
from openstock.mapping import extract
from openstock.models import Dataset,Fact
from openstock.normalize import quarters
for ticker,(cik,_,_) in COMPANIES.items():
 path=Path('public/data')/(ticker+'.json');d=Dataset.model_validate_json(path.read_bytes())
 if ticker=='TSM':
  facts=[f for f in d.facts if f.metric not in {'ocf','icf','financing_cf','capex','sbc'}]+[Fact.model_validate(f) for f in json.load(open('/tmp/tsm-cash-facts.json'))]
 else:
  url=f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json'
  raw=json.loads((Path('.cache/sec')/(hashlib.sha256(url.encode()).hexdigest()+'.cache')).read_bytes())
  facts=extract(raw,cik,COMPANY_MAPPINGS.get(ticker))
  facts += [f for f in d.facts if f.tag.startswith('disclosure:')]
  if ticker=='SOFI':facts=[f for f in facts if str(f.end)>='2021-06-30']
 facts=[f for f in facts if not(f.quality=='derived' and f.source_refs)]
 if ticker=="NVDA":
  from openstock.nvidia_cash import reviewed_facts,apply_basis
  facts=apply_basis([f for f in facts if f.tag!="disclosure:nvda.productive_assets"]+reviewed_facts())
 from openstock.profit import add_gross_profit
 facts=add_gross_profit(facts,cik)
 q=quarters(facts);facts += [f for f in q if f.quality=='derived' and f.source_refs]
 d.facts=facts;d.updated=datetime.now(timezone.utc).isoformat()
 d.warnings=[w for w in d.warnings if '單季累積值' not in w]
 d.warnings.append('現金流累計值可於同一財年申報群組內相減，須同標籤、單位、會計準則、起日且版本數值穩定；衍生值保留兩筆來源及可知日期。')
 if ticker in {'SOFI','NVDA','AMZN'}:d.warnings.append('資本支出採官方 PaymentsToAcquireProductiveAssets，含不動產、廠房設備、軟體及其他無形資產；與僅 PPE 的公司定義不同。')
 atomic_json(path,d.model_dump(mode='json'))
 rows=sorted(f.end for f in q if f.metric=='ocf')[-20:]
 print(ticker,len(rows),str(rows[0]) if rows else '',str(rows[-1]) if rows else '', {m:sum(any(f.metric==m and f.end==e for f in q) for e in rows) for m in ['ocf','icf','financing_cf','capex','sbc']})
