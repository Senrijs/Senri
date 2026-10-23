import { createApp } from "../../src/index.ts";
import { serve } from "../../adapters/node/index.ts";

const app = createApp();

serve(app, { port: 3000 });