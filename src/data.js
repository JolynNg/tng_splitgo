// Default receipt items used as a fallback before OCR runs (and on the
// "open straight to dashboard" demo path). The contact directory now lives
// in DynamoDB (SplitGoContacts table) and is loaded via AuthContext.
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
