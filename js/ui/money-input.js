// Campo de valor "estilo app de banco": o usuário digita só números e eles
// preenchem da direita para a esquerda (4 5 9 0 => 45,90). No celular, o teclado
// numérico basta: sem vírgula, sem erro de formatação, mais rápido.
const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MAX_DIGITS = 11; // 999.999.999,99 (mesmo teto da validação)

export function attachMoneyInput(input, onChange) {
  const show = (cents) => { input.value = cents ? fmt.format(cents / 100) : ''; };
  const centsOf = () => Number(input.value.replace(/\D/g, '')) || 0;

  input.addEventListener('input', () => {
    const digits = input.value.replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITS);
    show(Number(digits) || 0);
    onChange?.();
  });

  return {
    getAmount: () => centsOf() / 100,
    setAmount: (value) => show(Math.round((Number(value) || 0) * 100)),
  };
}
