"""Sequential SEC filing history, including archived submissions when needed."""
def filings(client, cik, since="2021-01-01"):
    data=client.get_json(f'https://data.sec.gov/submissions/CIK{cik}.json')
    result=dict(data['filings']['recent'])
    for archive in data['filings'].get('files',[]):
        if archive['filingTo'] < since:
            continue
        old=client.get_json('https://data.sec.gov/submissions/'+archive['name'])
        for key in result:
            result[key].extend(old.get(key,['']*len(old['form'])))
    return result
