import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecr from "aws-cdk-lib/aws-ecr";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as logs from "aws-cdk-lib/aws-logs";
import type { Construct } from "constructs";

export class InstripeFoundationStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly repository: ecr.Repository;
  public readonly serviceLogGroup: logs.LogGroup;
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, "Network", {
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "application",
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
          cidrMask: 24,
          name: "database",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    this.repository = new ecr.Repository(this, "Repository", {
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    this.repository.addLifecycleRule({
      description: "Retain the most recent container images",
      maxImageCount: 30,
      tagStatus: ecr.TagStatus.ANY,
    });

    this.serviceLogGroup = new logs.LogGroup(this, "ServiceLogs", {
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.cluster = new ecs.Cluster(this, "Cluster", {
      vpc: this.vpc,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    new cdk.CfnOutput(this, "ClusterName", {
      value: this.cluster.clusterName,
    });
    new cdk.CfnOutput(this, "RepositoryUri", {
      value: this.repository.repositoryUri,
    });
    new cdk.CfnOutput(this, "ServiceLogGroupName", {
      value: this.serviceLogGroup.logGroupName,
    });
    new cdk.CfnOutput(this, "VpcId", {
      value: this.vpc.vpcId,
    });
  }
}
