# ABC analysis extract

Produces `artifact/abc-analysis-data.xlsx` — per-product revenue/units aggregates
with ABC classes, for feeding into an inventory analysis.

```bash
pnpm exec tsx artifact/abc/extract.ts       # dump -> artifact/abc/abc-data.json
pip install openpyxl                        # once
python3 artifact/abc/build_workbook.py      # json -> artifact/abc-analysis-data.xlsx
```

Notes:
- Groups products by `shortenProductName`, since the same item is relisted under
  different marketing titles; the workbook reports how many raw titles merged.
- Excludes any trailing part-month, matching the dashboard.
- Writes literal values, not formulas: LibreOffice is unavailable in this
  environment, so openpyxl formulas would ship without cached values and read as
  empty in pandas and other consumers.
- Classifies by revenue share (80/95). There is no cost data in the source
  system, so margin-weighted ABC is not possible without a cost list.
