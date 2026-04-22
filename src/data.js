export const PEOPLE = [
  { name: 'You',           me: true,  phone: null },
  { name: 'Aisyah Rahman', me: false, phone: '012-345 6789' },
  { name: 'Marcus Tan',    me: false, phone: '017-822 9911' },
  { name: 'Priya Nair',    me: false, phone: '019-550 1234' },
  { name: 'Daniel Lim',    me: false, phone: '016-700 8822' },
  { name: 'Siti Nuraini',  me: false, phone: '013-445 1201' },
  { name: 'Kelvin Chong',  me: false, phone: '011-214 7788' },
  { name: 'Hafiz Zainal',  me: false, phone: '018-990 3344' },
];

export const RECEIPT_ITEMS = [
  { id: 1, name: 'Roti Canai',       qty: 2,  unit: 3.00 },
  { id: 2, name: 'Nasi Lemak Ayam',  qty: 1,  unit: 9.50 },
  { id: 3, name: 'Maggi Goreng',     qty: 1,  unit: 8.00 },
  { id: 4, name: 'Mee Goreng Mamak', qty: 1,  unit: 8.50 },
  { id: 5, name: 'Satay Ayam',       qty: 10, unit: 1.50 },
  { id: 6, name: 'Teh Tarik',        qty: 3,  unit: 2.00 },
  { id: 7, name: 'Milo Ais',         qty: 1,  unit: 3.50 },
  { id: 8, name: 'Roti Tissue',      qty: 1,  unit: 7.00 },
];

export const DEFAULT_SELECTED = ['Aisyah Rahman', 'Marcus Tan', 'Priya Nair', 'Daniel Lim'];

export const DEFAULT_ASSIGNMENTS = {
  1: { shared: false, people: ['You', 'Aisyah Rahman'] },
  2: { shared: false, people: ['You'] },
  3: { shared: false, people: ['Marcus Tan'] },
  4: { shared: false, people: ['Priya Nair'] },
  5: { shared: true,  people: ['You', 'Aisyah Rahman', 'Marcus Tan', 'Priya Nair', 'Daniel Lim'] },
  6: { shared: false, people: ['You', 'Aisyah Rahman', 'Daniel Lim'] },
  7: { shared: false, people: ['Marcus Tan'] },
  8: { shared: true,  people: ['You', 'Aisyah Rahman', 'Marcus Tan', 'Priya Nair', 'Daniel Lim'] },
};
