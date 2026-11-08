// LazyMotion に渡す機能。domAnimation だけ(レイアウトの動きの domMax は使わない)
// 別のファイルにしておくと、描いたあとで読み込まれる
import { domAnimation } from "motion/react";

export default domAnimation;
