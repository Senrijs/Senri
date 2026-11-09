"use client";
// 検索。ビルドのときに書き出した索引(/api/search)をブラウザで読み、ブラウザの中で探す(サーバーは要らない)
import {
    SearchDialog,
    SearchDialogClose,
    SearchDialogContent,
    SearchDialogHeader,
    SearchDialogIcon,
    SearchDialogInput,
    SearchDialogList,
    SearchDialogOverlay,
    type SharedProps,
} from "fumadocs-ui/components/dialog/search";
import { useStaticSearch } from "fumadocs-core/search/client";
import { useI18n } from "fumadocs-ui/contexts/i18n";

export default function DefaultSearchDialog(props: SharedProps) {
    const { locale } = useI18n();
    const search = useStaticSearch({ locale });

    return (
        <SearchDialog {...search} {...props}>
            <SearchDialogOverlay />
            {/* s-search-content: トップとブログでは、ガラスの質感にする(components/home/home.css) */}
            <SearchDialogContent className="s-search-content">
                <SearchDialogHeader>
                    <SearchDialogIcon />
                    <SearchDialogInput />
                    <SearchDialogClose />
                </SearchDialogHeader>
                <SearchDialogList />
            </SearchDialogContent>
        </SearchDialog>
    );
}
