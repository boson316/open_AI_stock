import json,re,hashlib,subprocess,tempfile,os
from pathlib import Path
from openstock.sec import SECClient
from openstock.inline import InlineParser
from openstock.history import filings

client=SECClient()
result={'documents':[]}
try:
 r=filings(client,'0001046179')
 candidates=[i for i,f in enumerate(r['form']) if f=='6-K' and 'fsx' in r['primaryDocument'][i]][:2]
 for i in candidates:
  acc=r['accessionNumber'][i];base=f"https://www.sec.gov/Archives/edgar/data/1046179/{acc.replace('-','')}/"
  items=client.get_json(base+'index.json')['directory']['item']
  result['documents'].append({'index':base,'filed':r['filingDate'][i],'items':[x['name'] for x in items]})
  for x in items:
   name=x['name']
   if not name.endswith(('.htm','.pdf')) or name.startswith('R'):continue
   content=client.get_bytes(base+name)
   item={'source':base+name,'sha256':hashlib.sha256(content).hexdigest()}
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
    item['intro']=' '.join(parser.root.text().split())[:1000]
   result['documents'].append(item)
except Exception as e:
 result['error']=type(e).__name__+': '+str(e)
Path('data').mkdir(exist_ok=True)
Path('data/source-inspection.json').write_text(json.dumps(result,ensure_ascii=False,indent=2))
