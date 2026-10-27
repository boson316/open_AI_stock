import json,re,hashlib,subprocess,tempfile,os
from pathlib import Path
from openstock.sec import SECClient
from openstock.inline import InlineParser
from openstock.history import filings

client=SECClient()
result={'documents':[]}
try:
 r=filings(client,'0001046179')
 candidates=[i for i,f in enumerate(r['form']) if f=='6-K' and ('fsx' in r['primaryDocument'][i] or (re.fullmatch(r'tsm-6k_(?:2022(?:02|05|08|11)|202302)\d{2}\.htm',r['primaryDocument'][i]) and 8<=int(r['filingDate'][i][-2:])<=28))]
 for i in candidates:
  acc=r['accessionNumber'][i];base=f"https://www.sec.gov/Archives/edgar/data/1046179/{acc.replace('-','')}/"
  items=client.get_json(base+'index.json')['directory']['item']
  result['documents'].append({'index':base,'filed':r['filingDate'][i],'items':[x['name'] for x in items]})
  for x in items:
   name=x['name']
   if not name.endswith(('.htm','.pdf')) or name.startswith('R'):continue
   content=client.get_bytes(base+name)
   item={'source':base+name,'filed':r['filingDate'][i],'accession':acc,'sha256':hashlib.sha256(content).hexdigest()}
   if name.endswith('.pdf'):
    path=Path(tempfile.mkdtemp())/'filing.pdf';path.write_bytes(content)
    p=subprocess.run(['pdftotext','-layout',str(path),'-'],capture_output=True,text=True,check=True)
    text=p.stdout
    pages=text.split('\f')
    item['tables']=[page for page in pages if re.search('STATEMENTS OF CASH FLOWS|STATEMENTS OF FINANCIAL POSITION|BALANCE SHEETS',page,re.I)]
    item['intro']=text[:800]
   else:
    parser=InlineParser();parser.feed(content.decode())
    tables=[]
    for t in parser.root.walk('table'):
     rows=[[' '.join(c.text().split()) for c in row.children if c.tag in {'td','th'}] for row in t.walk('tr')]
     text=' '.join(' '.join(row) for row in rows)
     if re.search('cash flows|cash provided|cash used|operating activities|property.*equipment',text,re.I):tables.append(rows)
    item['tables']=tables
    text=' '.join(parser.root.text().split());item['intro']=text[:1000];item['unit_evidence']=[text[max(0,m.start()-100):m.end()+130] for m in list(re.finditer(r'thousands|millions|New Taiwan',text,re.I))[:8]]
   result['documents'].append(item)
 # NVIDIA's older capex concepts are absent from current CompanyFacts.
 r=filings(client,'0001045810')
 for i,f in enumerate(r['form']):
  if f not in {'10-Q','10-K'} or not '2022-01-01'<=r['filingDate'][i]<='2023-03-01':continue
  acc=r['accessionNumber'][i];url=f"https://www.sec.gov/Archives/edgar/data/1045810/{acc.replace('-','')}/{r['primaryDocument'][i]}"
  content=client.get_bytes(url);parser=InlineParser();parser.feed(content.decode())
  tables=[]
  for t in parser.root.walk('table'):
   rows=[[' '.join(c.text().split()) for c in row.children if c.tag in {'td','th'}] for row in t.walk('tr')]
   text=' '.join(' '.join(row) for row in rows)
   if re.search('purchases.*property|purchases.*equipment|purchases.*intangible',text,re.I):tables.append(rows)
  from openstock.inline import inline_facts
  tags=sorted({n.attrs.get('name','') for n in parser.root.walk('nonfraction') if re.search('PaymentsToAcquire.*(?:Property|Productive|Intangible)',n.attrs.get('name',''))})
  fs=inline_facts(content.decode(),{'capex':tags},filed=r['filingDate'][i],accession=acc,form=f,source=url,cik='0001045810')
  text=' '.join(parser.root.text().split());m=re.search('CONSOLIDATED STATEMENTS OF CASH FLOWS',text,re.I)
  result['documents'].append({'inline_capex':[v.model_dump(mode='json') for v in fs],'unit_evidence':text[m.start():m.start()+500] if m else '', 'tags':tags,'source':url,'filed':r['filingDate'][i],'accession':acc,'sha256':hashlib.sha256(content).hexdigest(),'tables':tables,'intro':'NVIDIA US GAAP consolidated cash flows'})
except Exception as e:
 result['error']=type(e).__name__+': '+str(e)
Path('data').mkdir(exist_ok=True)
Path('data/source-inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
