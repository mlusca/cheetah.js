export enum EventType {
    OnApplicationBoot = 'OnApplicationBoot',
    OnApplicationInit = 'OnApplicationInit',
    OnApplicationShutdown = 'OnApplicationShutdown',
    OnRequest = 'OnRequest',
    OnResponse = 'OnResponse'
}

export interface OnEvent {
    methodName: string;
    eventName: EventType;
    target: Object
}