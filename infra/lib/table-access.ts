import type { ITable } from "aws-cdk-lib/aws-dynamodb"
import { PolicyStatement } from "aws-cdk-lib/aws-iam"
import type { IFunction } from "aws-cdk-lib/aws-lambda"

/**
 * The item-level actions the deployed handlers use. No Scan, no deletes, no
 * table administration: "Delete Everything" runs from the console, not from
 * these functions.
 */
export const TABLE_READ = Object.freeze(["dynamodb:GetItem", "dynamodb:Query"])
export const TABLE_READ_WRITE = Object.freeze([
  ...TABLE_READ,
  "dynamodb:PutItem",
])

/** Grants exactly `actions` on the table and its indexes. */
export const grantTableActions = (
  fn: IFunction,
  table: ITable,
  actions: readonly string[]
): void => {
  fn.addToRolePolicy(
    new PolicyStatement({
      actions: [...actions],
      resources: [table.tableArn, `${table.tableArn}/index/*`],
    })
  )
}
