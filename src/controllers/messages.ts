import Base from './base'
import {arrayToObject} from '../common/helpers'
import Users from './users'
import User from "../models/user";
import assert from "assert";
import {fixIt, toTwacode} from "../common/twacode"
import {BadRequest} from "../common/errors";


export interface PostMessage {
    parent_message_id: string
    original_str: string
    prepared: Array<Object>
}

export  interface DeleteMessageRequest{
    message_id: string
    parent_message_id: string
}

export  interface ReactionsRequest{
    message_id: string
    parent_message_id: string
    "reaction": string
}

/**
 * Messages methods
 */
export default class extends Base {

    async init(channelId: string){
        const data = await this.api.post('/ajax/core/collections/init', {
            multiple: [
                {
                    "collection_id":"messages/" + channelId,
                    "options":{
                        "type":"messages",

                        //If you let this empty, then you'll retrieve only the websocket information
                        "get_options":{
                            "channel_id": channelId,
                            "limit": 0,
                            "offset":  false,
                            "parent_message_id":  ""
                        }
                    },
                    "_grouped":true
                }
            ]
        })

        const wsInfo = data[0].data

        return wsInfo
    }

    /**
     * Get messages GET /channels/<channel_id>/messages
     * @param {string} channelId
     * @param {int} [limit]
     * @param {string} [beforeMessageId]
     * @param {string} [messageId]
     * @return {Promise<object[]>}
     */
    async get(channelId: string, limit: number = 50, beforeMessageId?: string, messageId?: string) {
        let messages = await this.api.post('/ajax/discussion/get', {
            'options': {
                'channel_id': channelId,
                'limit': limit,
                'offset': beforeMessageId,
                'parent_message_id': '',
                'id': messageId
            },
        })

        if (!messages) {
            messages = []
        }

        messages.forEach((m: any)=>{
            if(m.id == 'eb948a72-3583-11eb-8d6b-0242ac120004'){
                console.log(m.content)
                console.log(m.content.prepared[0].content)
            }
        })


        const usersIds = new Set()
        let filteredMessages =
            messages.filter((a: any) => !(a['hidden_data'] instanceof Object && a['hidden_data']['type'] === 'init_channel'))
                .map((a: any) => {
                    if (a.sender) {
                        usersIds.add(a.sender)
                    }

                    if(!a.content){
                        a.content = {}
                    }

                    const r = {
                        id: a.id,
                        parent_message_id: a.parent_message_id || null,
                        responses_count: a.responses_count,
                        sender: a.sender ? {user_id: a.sender} : {
                            username: a.hidden_data.custom_title,
                            img: a.hidden_data.custom_icon,
                        },
                        creation_date: a.creation_date,
                        content: {
                            original_str: a.content.original_str,
                            prepared: null
                            // files: a.files
                        },
                        reactions: Object.keys(a.reactions).length ? a.reactions : null,
                        user_reaction: a._user_reaction

                    } as any

                    let prepared = a.content.prepared || a.content.formatted || a.content

                    // console.log(prepared)
                    if (!Array.isArray(prepared)){
                        prepared = [prepared]
                    }

                    assert(Array.isArray(prepared), 'wrong message content data')

                    const ready = [] as any[]

                    prepared.forEach(item => {
                        if (Array.isArray(item)) {
                            item.forEach(subitem => ready.push(subitem))
                        } else {
                            // NOP also can contains data ...
                            if (item.type == 'nop' && Array.isArray(item.content) && item.content.length){
                                item.content.forEach((s:any)=>{
                                    ready.push(s)
                                })
                                // console.log('push', item)
                            } else {
                                ready.push(item)
                            }
                        }
                    })

                    for (let idx in ready) {
                        try {
                            ready[idx] = fixIt(ready[idx])
                        } catch (e) {
                            console.error('---')
                            console.error(JSON.stringify(a.content, null, 2))
                            console.error('---')
                            ready[idx] = {"type": "unparseable"}
                        }
                    }

                    r.content.prepared = ready.filter(r => r)

                    if (!a.parent_message_id) {
                        r.responses = []
                    } else {
                        r.parent_message_id = a.parent_message_id
                    }

                    return r
                })


        const usersCtrl = new Users(this.userProfile)
        const usersHash = arrayToObject(await Promise.all(Array.from(usersIds.values()).map((user_id) => usersCtrl.getUser(user_id as string))), 'userId')
        const messagesHash = arrayToObject(filteredMessages, 'id')
        filteredMessages.forEach((a: any) => {
            if (a.sender.user_id) {
                const user = usersHash[a.sender.user_id]
                if (user) {
                    a.sender = user
                } else {
                    console.error('Not found for', a.sender)
                }
            }
            if (a['parent_message_id']) {
                messagesHash[a['parent_message_id']].responses.push(a)
                delete messagesHash[a.id]
            }
        })
        filteredMessages.forEach((a: any) => {

            if (!a.sender.userId){ // Fake ID for bots
                a.sender.userId = '00000000'
            }

            if (a.responses) {
                a.responses = a.responses.sort((a: any, b: any) => {
                    return a.creation_date - b.creation_date
                })
            } else {
                // pass
            }
        })


        return Object.values(messagesHash).sort((a: any, b: any) => a.creation_date - b.creation_date)
    }


    /**
     * Update message POST /channels/<channel_id>/messages
     * @param {string} channelId
     * @param {object} message
     * @return {Promise<{object}>}
     */
    async post(channelId: string, message: PostMessage) {

        assert(message.original_str, 'original_str is missing')

        const prepared = message.prepared || toTwacode(message.original_str)

        if (!prepared || prepared?.length === 0){
            throw new BadRequest('Unparseable message')
        }

        const obj = {
            'object': {
                channel_id: channelId,
                parent_message_id: message.parent_message_id,
                content: {
                    original_str: message.original_str,
                    prepared: prepared
                }
            }
        }

        const x = await this.api.post('/ajax/discussion/save', obj)

        // return {
        //     "id": x['object']['id']
        // }

        return x['object']
    }

    async deleteMessage(channelId: string, message: DeleteMessageRequest){
        assert(channelId, 'message_id is required');

        const obj = {
            'object': {
                channel_id: channelId,
                id: message.message_id,
                parent_message_id: message.parent_message_id
            }
        }

        // console.log(obj)
        return await this.api.post('/ajax/discussion/remove', obj)

    }

    async reactions(channelId: string, data: ReactionsRequest){

        const obj = {
            'object': {
                channel_id: channelId,
                id: data.message_id,
                parent_message_id: data.parent_message_id,
                _user_reaction:  data.reaction
            }
        }
        const res = await this.api.post('/ajax/discussion/save', obj)

        return {
            id: res.object.id,
            reactions: res.object.reactions
        }

    }
}
