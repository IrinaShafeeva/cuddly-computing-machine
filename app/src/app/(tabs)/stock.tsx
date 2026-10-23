import { Soon } from '@/components/Soon'

export default function Stock() {
  return <Soon title="ЗАПАСЫ" icon="🥫" points={[
    'Остатки с порогами: помидоры 5 шт, красный ≤ 1',
    'Отметил «кончается» — получил звёзды',
    'Красное само попадает в список покупок',
  ]} />
}
