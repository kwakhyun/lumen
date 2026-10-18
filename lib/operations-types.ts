export type ScheduleFrequency = 'daily' | 'weekly';
export type CollectionSchedule = {
  id:string;siteId:string;name:string;enabled:boolean;frequency:ScheduleFrequency;timezone:string;hour:number;minute:number;weekdays:number[];models:string[];promptIds:string[]|null;
  nextRunAt:string;lastRunAt:string|null;lastStatus:string|null;createdAt:string;updatedAt:string;
};
export type ScheduledExecution = {id:string;scheduleId:string|null;siteId:string;scheduleName:string;scheduledFor:string;status:'queued'|'running'|'completed'|'partial'|'failed'|'blocked'|'cancelled';runId:string|null;attempts:number;completed:number;failed:number;total:number;errorCode:string|null;message:string|null;createdAt:string;updatedAt:string;completedAt:string|null};
export type OperationAlert = {id:string;siteId:string;executionId:string|null;severity:'warning'|'critical';code:string;title:string;message:string;status:'open'|'acknowledged'|'resolved';createdAt:string;updatedAt:string};
export type OperationAudit = {id:string;siteId:string;action:string;subjectId:string|null;summary:string;createdAt:string};
export type OperationsHealth = {status:'healthy'|'attention'|'not_observed';lastHeartbeatAt:string|null;lastSuccessAt:string|null;activeExecutions:number;openAlerts:number;enabledSchedules:number;serviceSecretConfigured:boolean;message:string};
export type OperationsState = {schedules:CollectionSchedule[];executions:ScheduledExecution[];alerts:OperationAlert[];audit:OperationAudit[];health:OperationsHealth};
export type AutomationTickResult = {tickId:string;queued:number;processed:number;completed:number;failed:number;blocked:number;continuation:boolean;retryAfterSeconds:number;skipped:boolean;executionIds:string[];runIds:string[]};
export type ScheduleInput = {siteId:string;name:string;enabled?:boolean;frequency:ScheduleFrequency;timezone:string;hour:number;minute:number;weekdays?:number[];models:string[];promptIds?:string[]|null};
