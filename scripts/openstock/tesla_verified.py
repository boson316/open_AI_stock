"""Visually verified transcription of an official image-only GAAP table.

SEC Tesla Q4/FY2022 update, slide 4, reviewed 2026-10-28. The slide explicitly
restates comparative EPS for the August 2022 3-for-1 split. This is production
issuer data, not a test fixture. Preserve the image hash and source lineage.
"""
import hashlib
import calendar
from datetime import date
from .models import Fact

IMAGE='https://www.sec.gov/Archives/edgar/data/1318605/000156459023000799/slide-g0lictaep2w.jpg'
SHA256='ccf96261702ee3cd8a3847e06fefbbc20ba44247aa5a86432836d31ca5528cae'
SOURCE='https://www.sec.gov/Archives/edgar/data/1318605/000156459023000799/tsla-ex991_127.htm'
PERIODS=[(2021,4),(2022,1),(2022,2),(2022,3),(2022,4)]
VALUES={
    'revenue':[17719,18756,16934,21454,24318],
    'gross_profit':[4847,5460,4234,5382,5777],
    'operating_income':[2613,3603,2464,3688,3901],
    'net_income':[2321,3318,2259,3292,3687],
    'eps':[.68,.95,.65,.95,1.07],
    'ocf':[4585,3995,2351,5100,3278],
    'capex':[-1810,-1767,-1730,-1803,-1858],
}


def verified_history(client,reference_facts):
    if hashlib.sha256(client.get_bytes(IMAGE)).hexdigest()!=SHA256:
        raise ValueError('Tesla verified source image checksum mismatch; review required')
    result=[]
    for metric,values in VALUES.items():
        ref=next(f for f in reference_facts if f.metric==metric)
        for (year,q),value in zip(PERIODS,values):
            month=q*3
            result.append(Fact(metric=metric,value=value*(1 if metric=='eps' else 1000000),unit='USD/shares' if metric=='eps' else 'USD',
                start=date(year,month-2,1),end=date(year,month,calendar.monthrange(year,month)[1]),filed='2023-01-25',
                accession='0001564590-23-000799',tag=f'disclosure:0001318605.{metric}',basis=ref.basis or ref.tag,
                source=SOURCE,form='8-K',lineage=[f'Visually verified issuer image: {IMAGE}',f'SHA256 {SHA256}',
                'Slide 4; USD million except diluted EPS; comparative EPS retroactively adjusted by issuer for August 2022 split']))
    return result
