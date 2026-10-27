from datetime import date
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, FiniteFloat, model_validator


class Fact(BaseModel):
    model_config = ConfigDict(extra="forbid")
    metric: str
    value: FiniteFloat
    unit: str
    start: date | None = None
    end: date
    filed: date
    accession: str
    tag: str
    source: str
    form: str
    quality: Literal["reported", "derived"] = "reported"
    lineage: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def valid_dates(self):
        if self.start and self.start > self.end:
            raise ValueError("period starts after end")
        if self.filed < self.end:
            raise ValueError("filing predates period")
        return self


class Dataset(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: Literal[1] = 1
    ticker: str
    cik: str
    name: str
    sector: str
    updated: str
    source: str
    facts: list[Fact]
    warnings: list[str] = Field(default_factory=list)
