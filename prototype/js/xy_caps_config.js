// Supplied CAPS v2.3 template/config; private fixture defaults intentionally absent.
const XYCapsDefaults = {
  "general": {
    "comp_code_default": "E&P",
    "description": "Explicit configuration for HTML-to-CAPS Engine. No mock values are used."
  },
  "appl_code_defaults": {
    "PI": "KS01",
    "FL": "KS01",
    "FI": "KS01",
    "RF": "KS01",
    "VS": "KP11",
    "LI": "KS01",
    "OT_BOLTS": "KM01",
    "OT_OTHER": ""
  },
  "bolting_rules": {
    "default_bolt_short_name": "STB1",
    "default_bolt_description": "Studbolt with nuts",
    "type_mappings": [
      {
        "keyword": "blind/spacer",
        "short_name_bolts": "BSST"
      },
      {
        "keyword": "flange joint",
        "short_name_bolts": "BSFT"
      },
      {
        "keyword": "monofl",
        "short_name_bolts": "BSPM"
      },
      {
        "keyword": "default",
        "short_name_bolts": "BSF1"
      }
    ]
  },
  "dn_to_nps_map": {
    "15": "½",
    "20": "¾",
    "25": "1",
    "40": "1½",
    "50": "2",
    "65": "2½",
    "80": "3",
    "100": "4",
    "125": "5",
    "150": "6",
    "200": "8",
    "250": "10",
    "300": "12",
    "350": "14",
    "400": "16",
    "450": "18",
    "500": "20",
    "600": "24"
  },
  "bolt_fractions_map": {
    "1/2": "½",
    "5/8": "⅝",
    "3/4": "¾",
    "7/8": "⅞",
    "1": "1",
    "1 1/8": "1⅛",
    "1 1/4": "1¼",
    "1 3/8": "1⅜",
    "1 1/2": "1½",
    "1 5/8": "1⅝",
    "1 3/4": "1¾",
    "1 7/8": "1⅞",
    "2": "2",
    "2 1/4": "2¼",
    "2 1/2": "2½",
    "2 3/4": "2¾",
    "3": "3",
    "3 1/4": "3¼",
    "3 1/2": "3½",
    "3 5/8": "3⅝",
    "3 3/4": "3¾",
    "4": "4",
    "4 1/2": "4½",
    "4 3/4": "4¾",
    "5": "5",
    "5 1/4": "5¼",
    "5 1/2": "5½",
    "5 3/4": "5¾",
    "6": "6",
    "6 1/4": "6¼",
    "6 1/2": "6½"
  },
  "bolt_length_mm_to_in_map": {
    "60": "2⅜",
    "70": "2¾",
    "80": "3¼",
    "90": "3⅝",
    "100": "4",
    "110": "4½",
    "120": "4¾",
    "130": "5¼",
    "140": "5¾",
    "150": "6",
    "160": "6½",
    "170": "6¾",
    "180": "7¼",
    "190": "7½",
    "200": "8",
    "210": "8½",
    "220": "8¾",
    "230": "9¼",
    "240": "9½",
    "250": "10",
    "260": "10¼",
    "290": "11½",
    "300": "12",
    "330": "13",
    "340": "13½",
    "360": "14¼",
    "390": "15½"
  },
  "spec_meta_defaults": {
    "class_number": "",
    "mat_description": "",
    "ca_mm": "",
    "ca_in": "",
    "rating": "",
    "rev": ""
  }
};
const XYCapsColumns = [
        'Class number', 'Mat Description', 'Ca (mm)', 'Ca (in)', 'Rating', 'Rev.',
        'Short name', 'Short name bolts', 'Appl code', 'Comp Description',
        'Comp Description bolts', 'Comp Group', 'Size 1 (DN)', 'Size 1 (NPS)',
        'Size 2 (DN)', 'Size 2 (NPS)', 'Wlth 1 (Schedule / mm)', 'Wlth 1 (Schedule / in)',
        'Wlth 2 (Schedule / mm)', 'Wlth 2 (Schedule / in)', 'Pipe dia (DN)',
        'Pipe dia (NPS)', 'Bolt dia (in)', 'Bolt length (mm)', 'Bolt length (in)',
        'Number of bolts', 'MESC number', 'Mat. code', 'Class Material description', 'Comp. code'
      ];
