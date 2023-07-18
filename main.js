let BOT_TOKEN = '' // required
let OPEN_AI_API_KEY = '' // required




import { fileURLToPath } from 'url'
import fs, { createReadStream, createWriteStream } from 'fs'
import { unlink } from 'fs/promises'
import path, { dirname, resolve } from 'path'
const __dirname = dirname(fileURLToPath(import.meta.url))
import { Telegraf, session } from 'telegraf'
import { message } from 'telegraf/filters'
import axios from 'axios'
import ffmpeg from 'fluent-ffmpeg'
import installer from '@ffmpeg-installer/ffmpeg'
import { Configuration, OpenAIApi } from 'openai'
import { bold, italic, spoiler, code } from 'telegraf/format'




const bot = new Telegraf(BOT_TOKEN)

bot.use(session())

const INITIAL_SESSION = {
	messages: []
}

bot.command('start', async ctx => {
	ctx.session = INITIAL_SESSION
	await ctx.reply(spoiler('ready'))
})

bot.command('session', async ctx => {
	ctx.session = INITIAL_SESSION
	await ctx.reply(bold('new session started'))
})




async function removeFile(path) {
	try {
		await unlink(path)
	} catch (e) {
		console.log(e)
	}
}

class OggToMp3 {
	constructor() {
		ffmpeg.setFfmpegPath(installer.path)
	}

	toMp3(input, output) {
		try {
			const outputPath = resolve(dirname(input), `${output}.mp3`)
			return new Promise((resolve, reject) => {
				ffmpeg(input)
					.inputOptions('-t 30')
					.output(outputPath)
					.on('end', () => {
						removeFile(input)
						resolve(outputPath)
					})
					.on('error', () => reject(err.message))
					.run()
			})
		} catch (e) {
			console.log(e)
		}
	}

	async create(url, filename) {
		try {
			const oggPath = resolve(__dirname, '.', `${filename}.ogg`)
			const response = await axios({
				method: 'get',
				url,
				responseType: 'stream'
			})
			return new Promise(resolve => {
				const stream = createWriteStream(oggPath)
				response.data.pipe(stream)
				stream.on('finish', () => resolve(oggPath))
			})
		} catch (e) {
			console.log(e)
		}
	}
}

const oggToMp3 = new OggToMp3()




class OpenAI {
	roles = {
		assistant: 'assistant',
		user: 'user',
		system: 'system'
	}

	constructor(apiKey) {
		const configuration = new Configuration({
			apiKey
		})
		this.openai = new OpenAIApi(configuration)
	}

	async chat(messages) {
		try {
			const response = await this.openai.createChatCompletion({
				model: 'gpt-3.5-turbo',
				messages
			})
			return response.data.choices[0].message
		} catch (e) {
			console.log(e)
		}
	}

	async transcription(filepath) {
		try {
			const response = await this.openai.createTranscription(createReadStream(filepath), 'whisper-1')
			return response.data.text
		} catch (e) {
			console.log(e)
		}
	}
}

const openAI = new OpenAI(OPEN_AI_API_KEY)




bot.on(message('text'), async ctx => {
	try {
		ctx.session ??= INITIAL_SESSION
		await ctx.reply(bold('Запрос принят'))
		const message = ctx.message.text
		ctx.session.messages.push({ role: openAI.roles.user, content: message })
		const response = await openAI.chat(ctx.session.messages)
		ctx.session.messages.push({ role: openAI.roles.assistant, content: response.content })
		await ctx.reply(response.content)
	} catch (e) {
		console.log(e)
		ctx.reply(italic(`${e}`))
	}
})




bot.on(message('voice'), async ctx => {
	try {
		ctx.session ??= INITIAL_SESSION
		await ctx.reply(bold('Запрос принят'))
		const link = await ctx.telegram.getFileLink(ctx.message.voice.file_id)
		const userIdStr = String(ctx.message.from.id)
		const oggPath = await oggToMp3.create(link.href, userIdStr)
		const mp3Path = await oggToMp3.toMp3(oggPath, userIdStr)
		const message = await openAI.transcription(mp3Path)
		await removeFile(mp3Path)
		await ctx.reply('Ваш запрос:')
		await ctx.reply(code(`${message}`))
		ctx.session.messages.push({ role: openAI.roles.user, content: message })
		const response = await openAI.chat(ctx.session.messages)
		ctx.session.messages.push({ role: openAI.roles.assistant, content: response.content })
		await ctx.reply('ChatGPT:')
		await ctx.reply(response.content)
	} catch (e) {
		console.log(e)
		ctx.reply(italic(`${e}`))
	}
})




bot.launch()

function exitHandler() {
	bot.stop()
}

process.once('SIGINT', exitHandler)
process.once('SIGTERM', exitHandler)
