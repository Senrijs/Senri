// 箱の上の角に置く「+」の印(線の交点)。飾りなので読み上げない
export function Plus() {
    return (
        <>
            <i className="p ptl" aria-hidden="true" />
            <i className="p ptr" aria-hidden="true" />
        </>
    );
}
