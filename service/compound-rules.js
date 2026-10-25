export const COMPOUND_CAPACITY=8;
export const MAX_INVENTORY=6;

export const ROUTINE=[
  {id:'morning_count',label:'Morning count',room:'cell-block',required:true},
  {id:'breakfast',label:'Breakfast',room:'cafeteria',required:true},
  {id:'work',label:'Work detail',room:'workshop',required:true},
  {id:'exercise',label:'Exercise',room:'yard',required:false},
  {id:'lunch',label:'Lunch',room:'cafeteria',required:true},
  {id:'free_time',label:'Free time',room:null,required:false},
  {id:'evening_count',label:'Evening count',room:'cell-block',required:true},
  {id:'lockdown',label:'Lockdown',room:'cell-block',required:true},
];

export const ITEM_DEFINITIONS={
  food:{category:'food',contraband:false},medicine:{category:'medical',contraband:false},cloth:{category:'material',contraband:false},
  scrap:{category:'material',contraband:true},wire:{category:'material',contraband:true},adhesive:{category:'material',contraband:true},
  soap:{category:'legal',contraband:false},book:{category:'legal',contraband:false},tray:{category:'job_item',contraband:false},
  package:{category:'job_item',contraband:false},access_card:{category:'access',contraband:true},maintenance_key:{category:'access',contraband:true},
  cell_key:{category:'access',contraband:true},utility_key:{category:'access',contraband:true},staff_key:{category:'access',contraband:true},maintenance_pass:{category:'access',contraband:true},
  service_note:{category:'clue',contraband:false},utility_note:{category:'clue',contraband:false},perimeter_map:{category:'clue',contraband:true},guard_schedule:{category:'clue',contraband:true},
  improvised_tool:{category:'tool',contraband:true},wire_cutter:{category:'tool',contraband:true},panel_bypass:{category:'tool',contraband:true},
  concealment_wrap:{category:'tool',contraband:true},field_dressing:{category:'medical',contraband:false},energy_ration:{category:'food',contraband:false},
  service_uniform:{category:'access',contraband:true},distraction_kit:{category:'tool',contraband:true},rope_line:{category:'tool',contraband:true},
};

export const RECIPES=[
  {id:'improvised-tool',label:'Improvised tool',requires:['scrap','cloth'],output:'improvised_tool',intellect:1},
  {id:'wire-cutter',label:'Wire cutter',requires:['scrap','wire'],output:'wire_cutter',intellect:2},
  {id:'panel-bypass',label:'Panel bypass',requires:['wire','access_card'],output:'panel_bypass',intellect:3},
  {id:'concealment-wrap',label:'Concealment wrap',requires:['cloth','adhesive'],output:'concealment_wrap',intellect:1},
  {id:'field-dressing',label:'Field dressing',requires:['cloth','medicine'],output:'field_dressing',intellect:1},
  {id:'energy-ration',label:'Energy ration',requires:['food','medicine'],output:'energy_ration',intellect:2},
  {id:'service-uniform',label:'Service uniform',requires:['cloth','soap'],output:'service_uniform',intellect:2},
  {id:'distraction-kit',label:'Distraction kit',requires:['wire','soap'],output:'distraction_kit',intellect:2},
  {id:'rope-line',label:'Rope line',requires:['cloth','wire'],output:'rope_line',intellect:3},
  {id:'maintenance-key',label:'Maintenance key',requires:['scrap','adhesive'],output:'maintenance_key',intellect:3},
];

export const JOBS={
  janitor:{label:'Janitor',room:'showers',action:'Clean marked floor',quota:3,reward:3,stations:['dirty_spot']},
  kitchen:{label:'Kitchen worker',room:'kitchen',action:'Prepare and deliver trays',quota:3,reward:4,stations:['counter','stove','food_crate']},
  workshop:{label:'Workshop worker',room:'workshop',action:'Repair a work station',quota:3,reward:4,stations:['workbench','machine']},
  delivery:{label:'Delivery',room:'visitation',action:'Deliver a package',quota:2,reward:5,stations:['table']},
  maintenance:{label:'Maintenance',room:'utility',action:'Service a utility panel',quota:2,reward:5,stations:['panel','pipes']},
  medical:{label:'Medical assistant',room:'infirmary',action:'Prepare a treatment bed',quota:2,reward:5,stations:['medical_bed','cabinet']},
};

export const ESCAPE_PLANS=[
  {id:'service-gate',label:'Service Gate',position:{x:29,y:19},stages:[
    {id:'disguise',label:'Prepare service cover',position:{x:22,y:10},requires:['service_uniform']},
    {id:'access',label:'Spoof gate access',position:{x:26,y:19},requires:['access_card','distraction_kit']},
    {id:'breach',label:'Cross the service gate',position:{x:29,y:19},requires:[]},
  ]},
  {id:'maintenance-route',label:'Maintenance Route',position:{x:21,y:19},stages:[
    {id:'open-panel',label:'Open utility panel',position:{x:19,y:19},requires:['improvised_tool']},
    {id:'bypass',label:'Bypass the alarm',position:{x:20,y:18},requires:['panel_bypass']},
    {id:'crawl-out',label:'Use the service duct',position:{x:21,y:19},requires:[]},
  ]},
  {id:'perimeter-plan',label:'Perimeter Plan',position:{x:31,y:16},stages:[
    {id:'cut-inner',label:'Cut the inner fence',position:{x:15,y:20},requires:['wire_cutter']},
    {id:'anchor-line',label:'Anchor the crossing line',position:{x:24,y:16},requires:['rope_line']},
    {id:'cross',label:'Cross during a security gap',position:{x:31,y:16},requires:[]},
  ]},
];

export function securityFor(events,participants){
  const severe=events.slice(-30).filter(event=>['escape_stage','attack','knockout','restricted_entry'].includes(event.type)).length;
  const heat=Math.max(0,...participants.map(value=>value.heat||0));
  if(severe>=5||heat>=90)return'lockdown';
  if(severe>=3||heat>=65)return'alert';
  if(severe>=1||heat>=30)return'watch';
  return'normal';
}

export function nextRoutineIndex(current){return Math.min(ROUTINE.length-1,current+1);}
