/* Fictional personnel for the portfolio demo. */
const DEFAULT_EMPLOYEES = [
  {
    "id": "demo-1-auto-1",
    "name": "Demo Operator 1-auto-01",
    "category": "auto",
    "team": "А",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-auto-2",
    "name": "Demo Operator 1-auto-02",
    "category": "auto",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-auto-3",
    "name": "Demo Operator 1-auto-03",
    "category": "auto",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-auto-4",
    "name": "Demo Operator 1-auto-04",
    "category": "auto",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-auto-5",
    "name": "Demo Operator 1-auto-05",
    "category": "auto",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-auto-6",
    "name": "Demo Operator 1-auto-06",
    "category": "auto",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-manual-1",
    "name": "Demo Operator 1-manual-01",
    "category": "manual",
    "team": "А",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-manual-2",
    "name": "Demo Operator 1-manual-02",
    "category": "manual",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-manual-3",
    "name": "Demo Operator 1-manual-03",
    "category": "manual",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-1-manual-4",
    "name": "Demo Operator 1-manual-04",
    "category": "manual",
    "team": "А",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-1",
    "name": "Demo Operator 2-auto-01",
    "category": "auto",
    "team": "Б",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-2",
    "name": "Demo Operator 2-auto-02",
    "category": "auto",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-3",
    "name": "Demo Operator 2-auto-03",
    "category": "auto",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-4",
    "name": "Demo Operator 2-auto-04",
    "category": "auto",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-5",
    "name": "Demo Operator 2-auto-05",
    "category": "auto",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-auto-6",
    "name": "Demo Operator 2-auto-06",
    "category": "auto",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-manual-1",
    "name": "Demo Operator 2-manual-01",
    "category": "manual",
    "team": "Б",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-manual-2",
    "name": "Demo Operator 2-manual-02",
    "category": "manual",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-manual-3",
    "name": "Demo Operator 2-manual-03",
    "category": "manual",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-2-manual-4",
    "name": "Demo Operator 2-manual-04",
    "category": "manual",
    "team": "Б",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-1",
    "name": "Demo Operator 3-auto-01",
    "category": "auto",
    "team": "В",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-2",
    "name": "Demo Operator 3-auto-02",
    "category": "auto",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-3",
    "name": "Demo Operator 3-auto-03",
    "category": "auto",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-4",
    "name": "Demo Operator 3-auto-04",
    "category": "auto",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-5",
    "name": "Demo Operator 3-auto-05",
    "category": "auto",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-auto-6",
    "name": "Demo Operator 3-auto-06",
    "category": "auto",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-manual-1",
    "name": "Demo Operator 3-manual-01",
    "category": "manual",
    "team": "В",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-manual-2",
    "name": "Demo Operator 3-manual-02",
    "category": "manual",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-manual-3",
    "name": "Demo Operator 3-manual-03",
    "category": "manual",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-3-manual-4",
    "name": "Demo Operator 3-manual-04",
    "category": "manual",
    "team": "В",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-1",
    "name": "Demo Operator 4-auto-01",
    "category": "auto",
    "team": "Г",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-2",
    "name": "Demo Operator 4-auto-02",
    "category": "auto",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-3",
    "name": "Demo Operator 4-auto-03",
    "category": "auto",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-4",
    "name": "Demo Operator 4-auto-04",
    "category": "auto",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-5",
    "name": "Demo Operator 4-auto-05",
    "category": "auto",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-auto-6",
    "name": "Demo Operator 4-auto-06",
    "category": "auto",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-manual-1",
    "name": "Demo Operator 4-manual-01",
    "category": "manual",
    "team": "Г",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-manual-2",
    "name": "Demo Operator 4-manual-02",
    "category": "manual",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-manual-3",
    "name": "Demo Operator 4-manual-03",
    "category": "manual",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-4-manual-4",
    "name": "Demo Operator 4-manual-04",
    "category": "manual",
    "team": "Г",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-stickers-1",
    "name": "Demo Sticker Operator 01",
    "category": "stickers",
    "team": "1 смяна",
    "role": "Началник смяна",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-stickers-2",
    "name": "Demo Sticker Operator 02",
    "category": "stickers",
    "team": "1 смяна",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-stickers-3",
    "name": "Demo Sticker Operator 03",
    "category": "stickers",
    "team": "1 смяна",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  },
  {
    "id": "demo-stickers-4",
    "name": "Demo Sticker Operator 04",
    "category": "stickers",
    "team": "1 смяна",
    "role": "Опаковчик",
    "active": true,
    "note": ""
  }
];
const DEFAULT_PERSONNEL_SETTINGS = {"stickersStage1": 4, "stickersStage2": 6};
