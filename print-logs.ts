import { resolveGatewayLogPaths } from "./src/daemon/launchd.js";
console.log(resolveGatewayLogPaths(process.env));
