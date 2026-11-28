// metricsHandler() の最後に足す行を作るもの。selfHeal() などが、使われたときにだけ登録する
// 依存の向き: selfHeal() → ここ ← metrics.ts。metrics() だけのアプリには、selfHeal() のコードが入らない
// 受け取る escape は、ラベルの値のエスケープ(metrics.ts と同じもの)
export const extraMetrics = new Set<(escape: (value: string) => string) => string[]>();
