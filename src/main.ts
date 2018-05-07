import fs = require("fs");
import util = require("util");
import {Agent} from "./agent";

function main() {
  if (process.argv.length != 2) {
    console.log("Usage: node " + process.argv[1])
    return;
  }

  let agent = new Agent();
  agent.start();
}

main();
