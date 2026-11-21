// @ts-check
// --target k8s: Deployment と Service のマニフェストを作る
// 止まり方を serve() に噛み合わせる:
//   Pod が Terminating になる → Service の振り分けから外れ始める(反映には数秒かかる)
//   → preStop の sleep の間は、まだ来るリクエストにふつうに答える
//   → SIGTERM → serve() が /readyz を 503 にし、新しい接続を断り、処理中のリクエストを shutdownTimeout まで待つ
//   → onShutdown → 終わる
// terminationGracePeriodSeconds は preStop も含めた全体の時間なので、preStop + shutdownTimeout + 余裕 にする
import { NONROOT } from "./docker.js";

/** @typedef {import("./project.js").Project} Project */
/** @typedef {import("./write.js").GeneratedFile} GeneratedFile */

// onShutdown(DB を閉じるなど)に残しておく秒数
export const SHUTDOWN_MARGIN = 5;

/**
 * @typedef {object} K8sOptions
 * @property {number} port
 * @property {string} image
 * @property {number} shutdownTimeout ミリ秒(serve() の shutdownTimeout と同じ値にする)
 * @property {number} preStopSleep 秒。0 なら preStop を書かない(Kubernetes 1.30 より前のクラスター向け)
 * @property {string} healthPath
 * @property {string} readyPath
 * @property {string} header
 */

/**
 * @param {K8sOptions} options
 */
export function gracePeriod(options) {
    return options.preStopSleep + Math.ceil(options.shutdownTimeout / 1000) + SHUTDOWN_MARGIN;
}

/**
 * YAML の文字列。迷う値はすべて引用符で囲む(JSON の文字列は YAML の文字列としても正しい)
 * @param {string} value
 */
const q = (value) => JSON.stringify(value);

/**
 * @param {Project} project
 * @param {K8sOptions} options
 * @returns {{ files: GeneratedFile[]; notes: string[] }}
 */
export function k8s(project, options) {
    const { name } = project;
    const { port, image, shutdownTimeout, preStopSleep, healthPath, readyPath } = options;
    const grace = gracePeriod(options);
    const timeoutSeconds = Math.ceil(shutdownTimeout / 1000);

    const preStop =
        preStopSleep > 0
            ? [
                  "          # Keep answering while the Pod is being removed from the Service's endpoints (that takes a few",
                  "          # seconds). SIGTERM is sent after this sleep. The native sleep action needs Kubernetes 1.30 or later",
                  "          # (the image has no shell, so `exec: sleep` would not work). On older clusters, run",
                  "          # `senri build --target k8s --pre-stop-sleep 0 --force` and read the note it writes here.",
                  "          lifecycle:",
                  "            preStop:",
                  "              sleep:",
                  `                seconds: ${preStopSleep}`,
              ]
            : [
                  "          # No preStop (--pre-stop-sleep 0). SIGTERM arrives as soon as the Pod starts terminating, while the",
                  "          # Service may still send it requests for a few seconds. serve() refuses new connections at once,",
                  "          # so some requests can fail during a rollout. On Kubernetes 1.30 or later, use the default instead.",
              ];

    const deployment = [
        options.header,
        "#",
        "# Assumptions (edit this file if any of them is wrong; senri build will not overwrite it):",
        `# - The image is ${image}. Build and push it yourself (senri build --target docker writes a Dockerfile).`,
        `# - The app listens on port ${port} (PORT is set to it; serve() from @senrijs/senri/serve reads PORT).`,
        `# - The app uses health() from @senrijs/senri with the paths ${healthPath} and ${readyPath}.`,
        "#   Without it, both probes fail and the Pod never becomes ready.",
        `# - shutdownTimeout in serve() is ${shutdownTimeout} ms${shutdownTimeout === 10000 ? " (the default)" : ""}. If you change it, run`,
        "#   senri build again with --shutdown-timeout and --force, or change terminationGracePeriodSeconds yourself.",
        `# - terminationGracePeriodSeconds: ${grace} = preStop ${preStopSleep} s + shutdownTimeout ${timeoutSeconds} s + ${SHUTDOWN_MARGIN} s for onShutdown.`,
        "#   After it, Kubernetes sends SIGKILL.",
        "# - replicas and resources are placeholders, not measurements. Measure your app and change them.",
        "#   There is no CPU limit on purpose (a limit throttles even when the node has idle CPU).",
        "# - The root filesystem is read-only. /tmp is a writable emptyDir.",
        "apiVersion: apps/v1",
        "kind: Deployment",
        "metadata:",
        `  name: ${q(name)}`,
        "  labels:",
        `    app.kubernetes.io/name: ${q(name)}`,
        "spec:",
        "  replicas: 2",
        "  selector:",
        "    matchLabels:",
        `      app.kubernetes.io/name: ${q(name)}`,
        "  template:",
        "    metadata:",
        "      labels:",
        `        app.kubernetes.io/name: ${q(name)}`,
        "    spec:",
        `      terminationGracePeriodSeconds: ${grace}`,
        "      securityContext:",
        "        runAsNonRoot: true",
        `        runAsUser: ${NONROOT}`,
        `        runAsGroup: ${NONROOT}`,
        "      containers:",
        "        - name: app",
        `          image: ${q(image)}`,
        "          ports:",
        "            - name: http",
        `              containerPort: ${port}`,
        "          env:",
        "            - name: PORT",
        `              value: ${q(String(port))}`,
        "            - name: NODE_ENV",
        '              value: "production"',
        "          # Liveness: restart the container only when the process cannot answer at all.",
        "          livenessProbe:",
        "            httpGet:",
        `              path: ${q(healthPath)}`,
        "              port: http",
        "            periodSeconds: 10",
        "            failureThreshold: 3",
        "          # Readiness: send traffic only while ready. serve() turns this to 503 on SIGTERM.",
        "          readinessProbe:",
        "            httpGet:",
        `              path: ${q(readyPath)}`,
        "              port: http",
        "            periodSeconds: 5",
        "            failureThreshold: 2",
        ...preStop,
        "          resources:",
        "            requests:",
        '              cpu: "100m"',
        '              memory: "128Mi"',
        "            limits:",
        '              memory: "256Mi"',
        "          securityContext:",
        "            allowPrivilegeEscalation: false",
        "            readOnlyRootFilesystem: true",
        "            capabilities:",
        '              drop: ["ALL"]',
        "          volumeMounts:",
        "            - name: tmp",
        "              mountPath: /tmp",
        "      volumes:",
        "        - name: tmp",
        "          emptyDir: {}",
        "",
    ].join("\n");

    const service = [
        options.header,
        "#",
        "# Assumptions (edit this file if any of them is wrong; senri build will not overwrite it):",
        `# - ClusterIP, reachable inside the cluster on port 80 and forwarded to the container's port ${port} ("http").`,
        "#   To expose it outside the cluster, add an Ingress / Gateway, or change the type.",
        "apiVersion: v1",
        "kind: Service",
        "metadata:",
        `  name: ${q(name)}`,
        "  labels:",
        `    app.kubernetes.io/name: ${q(name)}`,
        "spec:",
        "  type: ClusterIP",
        "  selector:",
        `    app.kubernetes.io/name: ${q(name)}`,
        "  ports:",
        "    - name: http",
        "      port: 80",
        "      targetPort: http",
        "",
    ].join("\n");

    return {
        files: [
            { path: "k8s/deployment.yaml", content: deployment },
            { path: "k8s/service.yaml", content: service },
        ],
        notes: [],
    };
}
