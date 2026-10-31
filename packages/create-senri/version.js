// テンプレートに書き込む @senrijs/senri のバージョンの範囲(npm の package.json と、Deno の jsr: の両方)
// テンプレートのコードは、この範囲の API で書いてある。本体がこの範囲の外(0.3.0 など)に上がったら、
// テンプレートを直してから、ここも上げる(test/node/create-senri.test.ts が、本体の version を満たしているかを確かめる)
export const SENRI_RANGE = "^0.2.2";
