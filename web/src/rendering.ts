import type {State,Config,GameEvent} from './types.js';
export interface GameRenderer {
 selected:string;favorite:Set<string>;paused:boolean;speed:number;reducedMotion:boolean;
 update(state:State,config:Config,event?:GameEvent):void;
 reset():void;
 destroy():void;
}
