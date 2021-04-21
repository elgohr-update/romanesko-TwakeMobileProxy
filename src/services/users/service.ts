import assert from "assert";
import Api from "../../common/twakeapi";
import {BadRequest} from "../../common/errors";
import FormData from "form-data";

export default class UsersService {

    constructor(protected api: Api) {
    }

    getJwtToken(){
        return this.api.token
    }

    async getCurrent(timeZoneOffset?: number) {
        const params = {} as any
        if (timeZoneOffset) {
            assert(!isNaN(+timeZoneOffset), 'timezone should be numeric (i.e. -180 for Moscow)')
            params.timezone = timeZoneOffset
        }
        return this.api.post('/ajax/users/current/get', params).then(a => {
            a.data.user_is_organization_administrator = a.data.workspaces && a.data.workspaces.length && a.data.workspaces[0]._user_is_organization_administrator
            return a.data
        })
    }

    async getUserById(id: string) {

        // if (usersCache[id]) return usersCache[id]

        return this.api.post('/ajax/users/all/get', {'id': id}).then(a=>{
            if (a.errors && a.errors.length){
                throw new BadRequest(`User id ${id} not found`)
            }
            // usersCache[id] = a.data
            return a.data
        })
    }

    setJWTToken(token:string){
        this.api.token = token
        return this
    }

    async searchUsers(companyId: string, name: string) {
        const params = {"options": {"scope": "group", "name": name, "group_id": companyId, "language_preference": "en"}}
        return await this.api.post('/ajax/users/all/search', params).then((a:any) => a.data.users)
    }

    async changeLanguage(language: string) {
        return this.api.post('/ajax/users/account/language', {"language":language,"sentByLanguageService":true})
    }

    async updateFirstLastName(firstname: string, lastname: string) {
        const form = new FormData();
        form.append('firstname', firstname);
        form.append('lastname', lastname);

        return  this.api.post('/ajax/users/account/identity', form, form.getHeaders())
    }

    async changePassword(old_password: string, password: string){
        const x= await this.api.post('/ajax/users/account/password', {old_password,password})
        if(x.errors && x.errors.length) throw new BadRequest('Bad password')
    }

}