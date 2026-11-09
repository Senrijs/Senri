-- bench/http.ts が wrk に渡すスクリプト(wrk -s wrk.lua)
-- - メソッドは環境変数 WRK_METHOD で決める(POST のルートも同じスクリプトで測るため)
-- - 終わったら、結果を JSON で 1 行出す(行の頭は WRK_JSON)。wrk の表示の文字を読むより、版による違いで壊れにくい
--   status: 2xx と 3xx 以外の応答の数(wrk の「Non-2xx or 3xx responses」)。http.ts が、期待どおりかを確かめる

wrk.method = os.getenv("WRK_METHOD") or "GET"

function done(summary, latency, requests)
  local e = summary.errors
  io.write(string.format(
    'WRK_JSON {"requests":%d,"duration_us":%d,"bytes":%d,"connect":%d,"read":%d,"write":%d,"status":%d,"timeout":%d,"latency_p50_us":%d,"latency_p99_us":%d}\n',
    summary.requests, summary.duration, summary.bytes,
    e.connect, e.read, e.write, e.status, e.timeout,
    latency:percentile(50), latency:percentile(99)
  ))
end
