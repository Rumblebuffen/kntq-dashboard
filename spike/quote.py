# Throwaway: fetch a page, strip tags, print context around each pattern. usage: python3 spike/quote.py URL pat1 pat2 ...
import re, sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={'User-Agent': 'Mozilla/5.0'})
try:
    html = urllib.request.urlopen(req, timeout=30).read().decode('utf-8', 'replace')
except Exception as e:
    print('  FETCH FAILED', e); sys.exit(0)
text = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', re.sub(r'(?s)<(script|style)[^>]*>.*?</\1>', ' ', html)))
for p in sys.argv[2:]:
    ms = list(re.finditer(p, text, re.I))
    print(f'  [{p}] {len(ms)} hit(s)')
    for m in ms[:2]:
        print('    …' + text[max(0, m.start() - 110):m.end() + 150].strip() + '…')
