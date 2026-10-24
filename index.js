require('dotenv').config();
const keepAlive = require('./keep_alive.js');
const { Client, GatewayIntentBits } = require('discord.js');
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    NoSubscriberBehavior,
    getVoiceConnection
} = require('@discordjs/voice');
const play = require('play-dl');

// Khởi chạy Web Server giữ bot online (cho Render/Koyeb)
keepAlive();

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Lưu trữ hàng đợi (Queue) và trạng thái lặp cho từng Server (Guild)
const serverQueues = new Map();

client.once('clientReady', () => {
    console.log(`Bot đã sẵn sàng! Đăng nhập dưới tên: ${client.user.tag}`);
});

client.on('messageCreate', async message => {
    if (message.author.bot) return;
    if (!message.content.startsWith('!')) return;

    const args = message.content.split(' ');
    const command = args[0].toLowerCase();
    const serverQueue = serverQueues.get(message.guild.id);

    // 1. Lệnh phát nhạc: !play <link_youtube>
    if (command === '!nhac') {
        const voiceChannel = message.member?.voice.channel;
        if (!voiceChannel) return message.reply('❌ Bạn cần vào một kênh thoại trước!');

        const url = args[1];
        if (!url) return message.reply('❌ Vui lòng dán link YouTube theo cú pháp: `!play <link>`');

        const permissions = voiceChannel.permissionsFor(message.client.user);
        if (!permissions.has(GatewayIntentBits.GuildVoiceStates) && !permissions.has(GatewayIntentBits.ViewChannel)) {
            return message.reply('❌ Bot cần quyền tham gia và nói chuyện trong kênh thoại đó!');
        }

        try {
            // Kiểm tra thông tin video từ YouTube
            let validated = await play.validate(url);
            if (!validated) return message.reply('❌ Link YouTube không hợp lệ!');

            let songInfo = await play.video_info(url);
            let song = {
                title: songInfo.video_details.title,
                url: songInfo.video_details.url
            };

            if (!serverQueue) {
                // Tạo queue mới nếu chưa có
                const queueContruct = {
                    textChannel: message.channel,
                    voiceChannel: voiceChannel,
                    connection: null,
                    songs: [],
                    player: createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } }),
                    loop: false,
                    volume: 1.0
                };

                serverQueues.set(message.guild.id, queueContruct);
                queueContruct.songs.push(song);

                try {
                    const connection = joinVoiceChannel({
                        channelId: voiceChannel.id,
                        guildId: voiceChannel.guild.id,
                        adapterCreator: voiceChannel.guild.voiceAdapterCreator,
                        selfDeaf: true
                    });
                    queueContruct.connection = connection;
                    playSong(message.guild.id, queueContruct.songs[0]);
                    message.reply(`🎵 Đã thêm vào hàng đợi và bắt đầu phát: **${song.title}**`);
                } catch (err) {
                    console.error(err);
                    serverQueues.delete(message.guild.id);
                    return message.reply('❌ Không thể kết nối vào kênh thoại.');
                }
            } else {
                serverQueue.songs.push(song);
                return message.reply(`✅ Đã thêm vào hàng đợi: **${song.title}**`);
            }
        } catch (error) {
            console.error(error);
            message.reply('❌ Đã xảy ra lỗi khi xử lý bài hát.');
        }
    }

    // 2. Lệnh bỏ qua bài hát: !skip
    else if (command === '!skip') {
        if (!serverQueue) return message.reply('❌ Không có bài hát nào đang phát để skip!');
        if (!message.member.voice.channel) return message.reply('❌ Bạn cần ở trong cùng kênh thoại với bot!');
        
        serverQueue.player.stop();
        message.reply('⏭️ Đã bỏ qua bài hát hiện tại.');
    }

    // 3. Lệnh tạm dừng / tiếp tục: !pause / !resume
    else if (command === '!pause') {
        if (!serverQueue) return message.reply('❌ Không có nhạc đang phát!');
        serverQueue.player.pause();
        message.reply('⏸️ Đã tạm dừng phát nhạc.');
    } 
    else if (command === '!resume') {
        if (!serverQueue) return message.reply('❌ Không có nhạc đang phát!');
        serverQueue.player.unpause();
        message.reply('▶️ Tiếp tục phát nhạc!');
    }

    // 4. Lệnh lặp lại bài hát hiện tại: !loop
    else if (command === '!loop') {
        if (!serverQueue) return message.reply('❌ Bot chưa tham gia phát nhạc!');
        serverQueue.loop = !serverQueue.loop;
        message.reply(`🔂 Chế độ lặp lại (Loop): **${serverQueue.loop ? 'BẬT' : 'TẮT'}**`);
    }

    // 5. Lệnh dừng hẳn và thoát phòng: !stop / !out
    else if (command === '!stop' || command === '!out') {
        if (!serverQueue) {
            const connection = getVoiceConnection(message.guild.id);
            if (connection) connection.destroy();
            return message.reply('👋 Đã rời phòng.');
        }
        serverQueue.songs = [];
        serverQueue.player.stop();
        if (serverQueue.connection) serverQueue.connection.destroy();
        serverQueues.delete(message.guild.id);
        message.reply('👋 Đã dừng nhạc và rời kênh thoại.');
    }
});

// Hàm xử lý phát nhạc từ Queue
async function playSong(guildId, song) {
    const serverQueue = serverQueues.get(guildId);
    if (!song) {
        if (serverQueue && serverQueue.connection) {
            serverQueue.connection.destroy();
        }
        serverQueues.delete(guildId);
        return;
    }

    try {
        let stream = await play.stream(song.url);
        const resource = createAudioResource(stream.stream, {
            inputType: stream.type,
            inlineVolume: true
        });

        serverQueue.player.play(resource);
        serverQueue.connection.subscribe(serverQueue.player);

        serverQueue.player.removeAllListeners(AudioPlayerStatus.Idle);
        serverQueue.player.on(AudioPlayerStatus.Idle, () => {
            if (!serverQueue.loop) {
                serverQueue.songs.shift(); // Xóa bài cũ khỏi hàng đợi
            }
            playSong(guildId, serverQueue.songs[0]);
        });

        serverQueue.player.on('error', error => {
            console.error('Lỗi phát nhạc:', error.message);
            serverQueue.songs.shift();
            playSong(guildId, serverQueue.songs[0]);
        });
    } catch (error) {
        console.error('Không thể stream bài hát:', error);
        serverQueue.songs.shift();
        playSong(guildId, serverQueue.songs[0]);
    }
}

client.login(process.env.DISCORD_TOKEN);
