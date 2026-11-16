// 和机器人框架无关的核心：学校接口、上学循环、课堂决定、日记。
// 各框架的插件只要实现 think（AI 想说什么）、Secrets（钥匙放哪）和存档，就能用它。
export * from './protocol.js'
export * from './http.js'
export * from './timetable.js'
export * from './class-link.js'
export * from './classroom.js'
export * from './prompts.js'
export * from './diary.js'
export * from './attendance.js'
export * from './students.js'
export * from './school.js'
export * from './host.js'
