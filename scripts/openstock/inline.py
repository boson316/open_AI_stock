"""Conservative official Inline XBRL extraction with reviewed concept mapping.

Only consolidated contexts, supported numeric formats, and explicit units are
accepted. Segment/dimension facts, unknown transforms, continuations and nil
remain unavailable. No inference from surrounding prose or table positions.
"""
from html.parser import HTMLParser
from decimal import Decimal, InvalidOperation
from .models import Fact
from .mapping import METRICS


class Node:
    def __init__(self, tag="root", attrs=None):
        self.tag = tag
        self.attrs = dict(attrs or [])
        self.children = []
        self.content = []

    def walk(self, suffix):
        for child in self.children:
            if child.tag.split(":")[-1] == suffix:
                yield child
            yield from child.walk(suffix)

    def text(self, separator=""):
        return separator.join(c.text(separator) if isinstance(c, Node) else c for c in self.content)


class InlineParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.root = Node()
        self.stack = [self.root]

    def handle_starttag(self, tag, attrs):
        node = Node(tag, attrs)
        self.stack[-1].children.append(node)
        self.stack[-1].content.append(node)
        if tag not in {"br", "img", "hr", "meta", "link", "input", "wbr"}:
            self.stack.append(node)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if self.stack[-1].tag == tag:
            self.stack.pop()

    def handle_endtag(self, tag):
        for i in range(len(self.stack)-1, 0, -1):
            if self.stack[i].tag == tag:
                self.stack = self.stack[:i]
                break

    def handle_data(self, data):
        self.stack[-1].content.append(data)


def inline_facts(html, mapping, *, filed, accession, form, source, cik):
    if not source.startswith(f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"):
        raise ValueError("Filing source must be official SEC URL for selected CIK")
    parser = InlineParser()
    parser.feed(html)
    contexts = {}
    for node in parser.root.walk("context"):
        if list(node.walk("explicitmember")) or list(node.walk("typedmember")) or list(node.walk("segment")) or list(node.walk("scenario")):
            continue
        ids = list(node.walk("identifier"))
        if not ids or ids[0].text().strip().lstrip('0') != str(int(cik)):
            continue
        starts, ends, instants = (list(node.walk(k)) for k in ("startdate", "enddate", "instant"))
        if instants:
            contexts[node.attrs["id"]] = (None, instants[0].text().strip())
        elif starts and ends:
            contexts[node.attrs["id"]] = (starts[0].text().strip(), ends[0].text().strip())
    units = {}
    for node in parser.root.walk("unit"):
        measures = [m.text().strip().split(":")[-1] for m in node.walk("measure")]
        if measures == ["USD"]:
            units[node.attrs["id"]] = "USD"
        elif measures == ["shares"]:
            units[node.attrs["id"]] = "shares"
        elif measures == ["USD", "shares"] and list(node.walk("divide")):
            units[node.attrs["id"]] = "USD/shares"
    tags = {tag: metric for metric, taglist in mapping.items() for tag in taglist if metric in METRICS}
    result = []
    for node in parser.root.walk("nonfraction"):
        attr = node.attrs
        tag = attr.get("name")
        metric = tags.get(tag)
        context = contexts.get(attr.get("contextref"))
        unit = units.get(attr.get("unitref"))
        if not metric or not context or unit != METRICS[metric][0] or attr.get("xsi:nil") in {"true", "1"} or "continuedat" in attr:
            continue
        transform = attr.get("format", "").split(":")[-1]
        if transform not in {"", "num-dot-decimal", "numdotdecimal", "fixed-zero", "zerodash"}:
            continue
        try:
            text = node.text().strip().replace(",", "").replace("\u00a0", "")
            number = Decimal(0) if transform in {"fixed-zero", "zerodash"} else Decimal(text)
            number *= Decimal(10) ** int(attr.get("scale", "0"))
            if attr.get("sign") == "-":
                number = -number
            result.append(Fact(metric=metric, value=float(number), unit=unit, start=context[0], end=context[1], filed=filed,
                accession=accession, tag=tag, source=source, form=form))
        except (InvalidOperation, ValueError, OverflowError):
            continue
    return result
