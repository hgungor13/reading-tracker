// Turkish date formatting helpers (display only — storage stays ISO yyyy-mm-dd).

export const TR_MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
]

// Monday-first weekday abbreviations (matches the calendar grid).
export const TR_WEEKDAYS = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']

// ISO "2026-07-04" → "04.07.2026" (Turkish gün.ay.yıl).
export function formatTR(iso: string | null | undefined): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${d.padStart(2, '0')}.${m.padStart(2, '0')}.${y}`
}
