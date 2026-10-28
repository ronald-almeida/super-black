export const PRODUCT = 'Super Black Bússola Vitalícia 2026';
export const OFFERS = Object.freeze([
  { id: 'nao-aluno', title: 'NÃO SOU ALUNO', description: 'Para quem está chegando agora na Bússola Executiva.', amount: 34700 },
  { id: 'aluno', title: 'ALUNO OU EX-ALUNO', description: 'Para quem já fez qualquer curso ou formação da Bússola.', amount: 29700 },
  { id: 'club', title: 'CLUB, ELITE OU BLACK 2025', description: 'A melhor condição, para quem já caminha com a gente.', amount: 24700 }
]);
export const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export function validDocument(value) {
  const n = String(value).replace(/\D/g, '');
  if (/^(\d)\1+$/.test(n)) return false;
  if (n.length === 11) {
    for (let length = 9; length <= 10; length++) {
      const sum = [...n.slice(0, length)].reduce((s, d, i) => s + Number(d) * (length + 1 - i), 0);
      const digit = (sum * 10 % 11) % 10;
      if (digit !== Number(n[length])) return false;
    }
    return true;
  }
  if (n.length === 14) {
    for (let length = 12; length <= 13; length++) {
      const weights = length === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2];
      const remainder = [...n.slice(0, length)].reduce((s,d,i) => s + Number(d) * weights[i], 0) % 11;
      if ((remainder < 2 ? 0 : 11 - remainder) !== Number(n[length])) return false;
    }
    return true;
  }
  return false;
}
