import { merge } from "lodash";
import { pluginConfigExt, runServerless } from "../utils/runServerless";

describe("queues", () => {
    it("should create all required resources", async () => {
        const { cfTemplate, computeLogicalId } = await runServerless({
            fixture: "queues",
            configExt: pluginConfigExt,
            cliArgs: ["package"],
        });
        expect(Object.keys(cfTemplate.Resources)).toStrictEqual([
            "ServerlessDeploymentBucket",
            "ServerlessDeploymentBucketPolicy",
            // Lambda worker
            "EmailsWorkerLogGroup",
            "IamRoleLambdaExecution",
            "EmailsWorkerLambdaFunction",
            // Lambda subscription to SQS
            "EmailsWorkerEventSourceMappingSQSEmailsQueueF057328A",
            // Queues
            "emailsDlq47F8494C",
            "emailsQueueF057328A",
        ]);
        const s = computeLogicalId("emails", "Queue");
        expect(cfTemplate.Resources[s]).toMatchObject({
            DeletionPolicy: "Delete",
            Properties: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                QueueName: expect.stringMatching(/test-queues-\w+-dev-emails/),
                RedrivePolicy: {
                    deadLetterTargetArn: {
                        "Fn::GetAtt": [computeLogicalId("emails", "Dlq"), "Arn"],
                    },
                    maxReceiveCount: 3,
                },
                VisibilityTimeout: 36,
            },
            Type: "AWS::SQS::Queue",
            UpdateReplacePolicy: "Delete",
        });
        expect(cfTemplate.Resources[computeLogicalId("emails", "Dlq")]).toMatchObject({
            DeletionPolicy: "Delete",
            Properties: {
                MessageRetentionPeriod: 1209600,
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                QueueName: expect.stringMatching(/test-queues-\w+-dev-emails-dlq/),
            },
            Type: "AWS::SQS::Queue",
            UpdateReplacePolicy: "Delete",
        });
        expect(cfTemplate.Resources.EmailsWorkerLambdaFunction).toMatchObject({
            DependsOn: ["EmailsWorkerLogGroup"],
            Properties: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                FunctionName: expect.stringMatching(/test-queues-\w+-dev-emailsWorker/),
                Handler: "worker.handler",
                MemorySize: 1024,
                Role: {
                    "Fn::GetAtt": ["IamRoleLambdaExecution", "Arn"],
                },
                Runtime: "nodejs12.x",
                Timeout: 6,
            },
            Type: "AWS::Lambda::Function",
        });
        expect(cfTemplate.Resources.EmailsWorkerEventSourceMappingSQSEmailsQueueF057328A).toEqual({
            DependsOn: ["IamRoleLambdaExecution"],
            Properties: {
                BatchSize: 1,
                Enabled: true,
                EventSourceArn: {
                    "Fn::GetAtt": [computeLogicalId("emails", "Queue"), "Arn"],
                },
                FunctionName: {
                    "Fn::GetAtt": ["EmailsWorkerLambdaFunction", "Arn"],
                },
                MaximumBatchingWindowInSeconds: 60,
            },
            Type: "AWS::Lambda::EventSourceMapping",
        });
        expect(cfTemplate.Outputs).toMatchObject({
            [computeLogicalId("emails", "QueueArn")]: {
                Description: 'ARN of the "emails" SQS queue.',
                Value: {
                    "Fn::GetAtt": [computeLogicalId("emails", "Queue"), "Arn"],
                },
            },
            [computeLogicalId("emails", "QueueUrl")]: {
                Description: 'URL of the "emails" SQS queue.',
                Value: {
                    Ref: computeLogicalId("emails", "Queue"),
                },
            },
        });
        // Lambda functions of the app are authorized to publish to SQS
        expect(cfTemplate.Resources.IamRoleLambdaExecution).toMatchObject({
            Type: "AWS::IAM::Role",
            Properties: {
                Policies: [
                    {
                        PolicyDocument: {
                            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                            Statement: expect.arrayContaining([
                                {
                                    Action: "sqs:SendMessage",
                                    Effect: "Allow",
                                    Resource: [
                                        {
                                            "Fn::GetAtt": [computeLogicalId("emails", "Queue"), "Arn"],
                                        },
                                    ],
                                },
                            ]),
                        },
                    },
                ],
            },
        });
    });

    it("sets the SQS visibility timeout to 6 times the function timeout", async () => {
        const { cfTemplate, computeLogicalId } = await runServerless({
            fixture: "queues",
            configExt: merge(pluginConfigExt, {
                constructs: {
                    emails: {
                        worker: {
                            timeout: 7,
                        },
                    },
                },
            }),
            cliArgs: ["package"],
        });
        expect(cfTemplate.Resources[computeLogicalId("emails", "Queue")]).toMatchObject({
            Properties: {
                VisibilityTimeout: 7 * 6,
            },
        });
        expect(cfTemplate.Resources.EmailsWorkerLambdaFunction).toMatchObject({
            Properties: {
                Timeout: 7,
            },
        });
    });

    it("allows changing the number of retries", async () => {
        const { cfTemplate, computeLogicalId } = await runServerless({
            fixture: "queues",
            configExt: merge(pluginConfigExt, {
                constructs: {
                    emails: {
                        maxRetries: 1,
                    },
                },
            }),
            cliArgs: ["package"],
        });
        expect(cfTemplate.Resources[computeLogicalId("emails", "Queue")]).toMatchObject({
            Properties: {
                RedrivePolicy: {
                    maxReceiveCount: 1,
                },
            },
        });
    });

    it("allows changing the batch size", async () => {
        const { cfTemplate } = await runServerless({
            fixture: "queues",
            configExt: merge(pluginConfigExt, {
                constructs: {
                    emails: {
                        batchSize: 10,
                    },
                },
            }),
            cliArgs: ["package"],
        });
        expect(cfTemplate.Resources.EmailsWorkerEventSourceMappingSQSEmailsQueueF057328A).toMatchObject({
            Properties: {
                BatchSize: 10,
            },
        });
    });

    it("allows defining a DLQ email alarm", async () => {
        const { cfTemplate, computeLogicalId } = await runServerless({
            fixture: "queues",
            configExt: merge(pluginConfigExt, {
                constructs: {
                    emails: {
                        alarm: "alerting@example.com",
                    },
                },
            }),
            cliArgs: ["package"],
        });
        expect(Object.keys(cfTemplate.Resources)).toStrictEqual([
            "ServerlessDeploymentBucket",
            "ServerlessDeploymentBucketPolicy",
            "EmailsWorkerLogGroup",
            "IamRoleLambdaExecution",
            "EmailsWorkerLambdaFunction",
            "EmailsWorkerEventSourceMappingSQSEmailsQueueF057328A",
            "emailsDlq47F8494C",
            "emailsQueueF057328A",
            // Alarm
            "emailsAlarmTopic594BAEC9",
            "emailsAlarmTopicSubscription688AECB6",
            "emailsAlarm1821C14F",
        ]);
        expect(cfTemplate.Resources[computeLogicalId("emails", "Alarm")]).toMatchObject({
            Properties: {
                AlarmActions: [
                    {
                        Ref: computeLogicalId("emails", "AlarmTopic"),
                    },
                ],
                AlarmDescription: "Alert triggered when there are failed jobs in the dead letter queue.",
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                AlarmName: expect.stringMatching(/test-queues-\w+-dev-emails-dlq-alarm/),
                ComparisonOperator: "GreaterThanThreshold",
                Dimensions: [
                    {
                        Name: "QueueName",
                        Value: {
                            "Fn::GetAtt": [computeLogicalId("emails", "Dlq"), "QueueName"],
                        },
                    },
                ],
                EvaluationPeriods: 1,
                MetricName: "ApproximateNumberOfMessagesVisible",
                Namespace: "AWS/SQS",
                Period: 60,
                Statistic: "Sum",
                Threshold: 0,
            },
        });
        expect(cfTemplate.Resources[computeLogicalId("emails", "AlarmTopic")]).toMatchObject({
            Properties: {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                TopicName: expect.stringMatching(/test-queues-\w+-dev-emails-dlq-alarm-topic/),
                DisplayName: "[Alert][emails] There are failed jobs in the dead letter queue.",
            },
        });
        expect(cfTemplate.Resources[computeLogicalId("emails", "AlarmTopicSubscription")]).toMatchObject({
            Properties: {
                Endpoint: "alerting@example.com",
                Protocol: "email",
                TopicArn: {
                    Ref: computeLogicalId("emails", "AlarmTopic"),
                },
            },
        });
    });
});
