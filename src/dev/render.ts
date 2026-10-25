// ページの HTML(ビルド済みの1枚)に、エラー情報の JSON を埋め込む
//
// JSON は <script type="application/json"> の中に入れる。HTML の解析では、script の中身は
// "</script" が出てくるまで続くので、エラーメッセージに "</script><script>alert(1)</script>" が
// 入っていると、そこで script が終わり、攻撃者のスクリプトが動いてしまう(XSS)
// そこで "<" などを JSON の \u 表記に置き換える。JSON.parse すれば元の文字に戻るので、データは変わらない

// テンプレートの中の置き場所。ここを JSON に置き換える
export const DATA_PLACEHOLDER = "<!--senri:data-->";

// JSON では使えるが、古い JavaScript では改行扱いになる2文字(U+2028 / U+2029)
// ソースに直接書くと見えない文字になってしまうので、コードポイントから作る
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

// 置き換え先は「\u」+ 16進4桁の6文字
const escapeChar = (ch: string) => "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");

const UNSAFE_PATTERN = new RegExp(`[<>&${LINE_SEPARATOR}${PARAGRAPH_SEPARATOR}]`, "g");

export function embedJson(data: unknown): string {
    return JSON.stringify(data).replace(UNSAFE_PATTERN, escapeChar);
}

// ブラウザで開いたとき(Accept に text/html がある)だけ HTML にする。curl や fetch の */* は対象外
// "text/html;q=0" は「HTML は要らない」という意味なので除く
export function wantsHtml(req: Request): boolean {
    const accept = req.headers.get("accept") ?? "";
    return accept.split(",").some((entry) => {
        const [type, ...params] = entry.split(";").map((s) => s.trim().toLowerCase());
        if (type !== "text/html") return false;
        const q = params.find((p) => p.startsWith("q="));
        return q === undefined || Number(q.slice(2)) > 0;
    });
}

// <div id="app"> の中の置き場所。スクリプトが動かないときに見える簡易表示(エスケープ済みの HTML)を入れる
export const FALLBACK_PLACEHOLDER = "<!--senri:fallback-->";

export function renderPage(template: string, data: unknown, fallbackHtml = ""): string {
    if (!template.includes(DATA_PLACEHOLDER)) {
        throw new Error(`ページのテンプレートに ${DATA_PLACEHOLDER} がありません`);
    }
    // 置き換え後の文字列を関数で返すのは、"$&" や "$1" が replace の特殊なパターンとして
    // 解釈されないようにするため(エラーメッセージに $ が入っていても、そのまま出る)
    // JSON の "<" も簡易表示の "<" もエスケープ済みなので、片方の中にもう片方の置き場所ができることはない
    const json = embedJson(data);
    return template.replace(DATA_PLACEHOLDER, () => json).replace(FALLBACK_PLACEHOLDER, () => fallbackHtml);
}
