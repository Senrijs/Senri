// ダッシュボードに出すリクエストの記録(メモリ上。再起動で消える)
// 直近の max 件だけを持ち、それより古いものから捨てる。追加とクリアは購読者(SSE)に知らせる

export type LogEvent<T> = { type: "request"; item: T } | { type: "clear" };

export class RequestLog<T extends { id: string }> {
    readonly max: number;
    // 古い順。新しいものは末尾に足す
    #items: T[] = [];
    #listeners = new Set<(event: LogEvent<T>) => void>();

    constructor(max = 200) {
        this.max = max;
    }

    get size(): number {
        return this.#items.length;
    }

    get listenerCount(): number {
        return this.#listeners.size;
    }

    add(item: T) {
        this.#items.push(item);
        // 上限を超えた分を、古いほう(先頭)から捨てる
        if (this.#items.length > this.max) {
            this.#items.splice(0, this.#items.length - this.max);
        }
        this.#emit({ type: "request", item });
    }

    // 新しい順
    list(): T[] {
        return [...this.#items].reverse();
    }

    get(id: string): T | undefined {
        return this.#items.find((item) => item.id === id);
    }

    clear() {
        this.#items = [];
        this.#emit({ type: "clear" });
    }

    // 戻り値の関数を呼ぶと購読をやめる(SSE の接続が切れたときに呼ぶ)
    subscribe(listener: (event: LogEvent<T>) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    #emit(event: LogEvent<T>) {
        for (const listener of this.#listeners) {
            try {
                listener(event);
            } catch {
                // 1つの購読者が壊れていても、記録やほかの購読者は止めない
            }
        }
    }
}
