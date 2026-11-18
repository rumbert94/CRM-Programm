# Validiert CII-XML gegen EN16931- und XRechnung-Schematron (Saxon HE)
import sys, re
from saxonche import PySaxonProcessor
S='/tmp/claude-0/tools/sch/'
xsls={'EN16931':S+'en/xslt/EN16931-CII-validation.xslt','XRechnung':S+'xr/schematron/cii/XRechnung-CII-validation.xsl'}
with PySaxonProcessor(license=False) as p:
    x=p.new_xslt30_processor()
    for f in sys.argv[1:]:
        for name,path in xsls.items():
            if name=='XRechnung' and 'xrechnung' not in open(f).read(): continue
            ex=x.compile_stylesheet(stylesheet_file=path)
            out=ex.transform_to_string(source_file=f)
            fails=re.findall(r'<svrl:failed-assert[^>]*?id="([^"]*)"[^>]*?flag="([^"]*)".*?<svrl:text>(.*?)</svrl:text>',out,re.S)
            if not fails: fails=re.findall(r'<svrl:failed-assert[^>]*?flag="([^"]*)"[^>]*?id="([^"]*)".*?<svrl:text>(.*?)</svrl:text>',out,re.S)
            print(f'{f} [{name}]: {len(fails)} Befunde')
            for a in fails: print('   ',a[0],a[1],a[2].strip()[:200])

from lxml import etree
schema=etree.XMLSchema(etree.parse('/tmp/claude-0/tools/xsd/external/schemas/d16b/data/standard/CrossIndustryInvoice_100pD16B.xsd'))
for f in sys.argv[1:]:
    ok=schema.validate(etree.parse(f))
    print(f'{f} [XSD D16B]:', 'ok' if ok else schema.error_log)
