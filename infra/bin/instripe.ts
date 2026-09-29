#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { InstripeFoundationStack } from "../lib/instripe-foundation-stack.js";

const app = new cdk.App();

new InstripeFoundationStack(app, "InstripeFoundation", {
  env: {
    account: "632404568231",
    region: "us-east-1",
  },
  description: "Network, container registry, ECS cluster, and logs for instripe.",
  terminationProtection: true,
});
