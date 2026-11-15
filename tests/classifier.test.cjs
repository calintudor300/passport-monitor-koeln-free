const test = require('node:test');
const assert = require('node:assert/strict');
const {classify, isServiceOption, availableDates} = require('../src/classifier.cjs');

test('selects correct passport and ID-card service',()=> {
 assert.ok(isServiceOption('Закордонний паспорт та (або) ID-картка'));
 assert.ok(!isServiceOption('Обрати'));
});
test('no slots only on explicit message',()=>{
 const r=classify({bodyText:'Вибачте, на даний момент всі місця зайняті! Вільні слоти з’являються у довільний час.',serviceSelected:true,dayOptions:[]});
 assert.equal(r.status,'no_slots');
});
test('a real day option means available even if stale no-slot text',()=>{
 const r=classify({bodyText:'Вибачте, на даний момент всі місця зайняті!',serviceSelected:true,dayOptions:[{label:'Обрати',value:''},{label:'17.11.2026',value:'2026-11-17',disabled:false}]});
 assert.equal(r.status,'available');
 assert.deepEqual(r.dates,['17.11.2026']);
});
test('unknown if no reliable signal',()=>{
 assert.equal(classify({bodyText:'Електронна черга Послуга Обрати день',serviceSelected:true,dayOptions:[]}).status,'unknown');
});
test('blocked on challenge',()=>{
 assert.equal(classify({bodyText:'Just a moment... Verify you are human',serviceSelected:false,dayOptions:[]}).status,'blocked');
});
test('disabled days and placeholders do not count',()=>{
 assert.deepEqual(availableDates([{label:'Обрати день',value:''},{label:'18.11',value:'18',disabled:true},{label:'21.11',value:'21',disabled:false}]),['21.11']);
});

test('explicit no-slots message is valid even when the service selector is hidden',()=>{
 const r=classify({bodyText:'На даний момент відсутні місця в електронній черзі!',serviceSelected:false,dayOptions:[]});
 assert.equal(r.status,'no_slots');
});
